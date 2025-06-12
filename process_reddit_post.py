import pandas as pd
import re
import json
import numpy as np
import praw
import os
import time
from datetime import datetime
from sqlalchemy import create_engine, text
from google_search import search as google_search_search
from flask import Flask, request, jsonify
import uuid
import base64 # Pour l'encodage base64 des images (simulé)

app = Flask(__name__)

# --- Configuration PRAW ---
reddit = praw.Reddit(
    client_id=os.getenv("REDDIT_CLIENT_ID", "YOUR_CLIENT_ID"),
    client_secret=os.getenv("REDDIT_CLIENT_SECRET", "YOUR_CLIENT_SECRET"),
    user_agent=os.getenv("REDDIT_USER_AGENT", "votre_application_analyse_diesel_v1.0"),
    username=os.getenv("REDDIT_USERNAME", "YOUR_REDDIT_USERNAME"),
    password=os.getenv("REDDIT_PASSWORD", "YOUR_REDDIT_PASSWORD")
)

# --- Configuration de la base de données PostgreSQL ---
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/testdb")
engine = create_engine(DATABASE_URL)

# --- Dictionnaires initiaux pour l'extraction (peuvent être ajustés dynamiquement) ---
BRANDS_DICT = {
    'detroit': ['6.2', 'detroit'], 'ford': ['powerstroke', 'f150', 'f250', 'f350', 'f450', 'f550', 'f650', 'f750', 'ranger'],
    'chevrolet': ['chevy', 'silverado', 'duramax', 'k30'], 'gmc': ['sierra', 'duramax'],
    'dodge': ['ram', 'cummins'], 'ram': ['1500', '2500', '3500', 'cummins'],
    'volkswagen': ['vw', 'tdi', 'jetta', 'golf', 'passat', 'touareg'], 'audi': ['a3', 'a4', 'a6', 'a8', 'q5', 'q7', 'tdi'],
    'bmw': ['x5', 'x3', '335d', '328d', '530d', '730d'], 'mercedes': ['mercedes-benz', 'sprinter', 'gl', 'glk', 'ml'],
    'toyota': ['hilux', 'land cruiser', 'tundra'], 'nissan': ['titan', 'patrol', 'navara'],
    'paccar': ['mx', 'mx-13'], 'cummins': ['isb', 'isx', 'n14', 'm11', 'b-series'],
    'duramax': ['lb7', 'lly', 'lbz', 'lmm', 'lml', 'l5p'],
    'international': ['dt466', 'maxxforce', 'navistar'], 'caterpillar': ['cat', 'c7', 'c9', 'c13', 'c15', '3406']
}

VEHICLE_TYPES = ['truck', 'pickup', 'semi', 'tractor', 'trailer', 'sedan', 'suv', 'van', 'car']

PROBLEMS = ['leak', 'smoke', 'noise', 'vibration', 'misfire', 'stall', 'not start', 
            'hard start', 'fuel', 'mpg', 'economy', 'exhaust', 'dpf', 'def', 'regen',
            'check engine', 'codes', 'power loss', 'turbo', 'injector', 'transmission',
            'overheating', 'cooling', 'brakes', 'electrical', 'charging', 'alternator',
            'battery', 'starter', 'glow plug', 'head gasket', 'black smoke', 'white smoke',
            'blue smoke', 'gray smoke', 'lift pump', 'high pressure pump', 'rail pressure',
            'blow-by', 'blowby', 'egr', 'oil pressure', 'water pump', 'aftertreatment']

# Global constants for 14-day delay
MIN_DAYS_FOR_COMMENTS = 14

# --- Définition du schéma des tables (simplifié pour Pandas to_sql) ---
TABLE_RAW_POSTS = 'raw_posts'
TABLE_PROCESSED_POSTS = 'processed_posts'
TABLE_DOCUMENT_METRICS = 'document_metrics'
TABLE_QA_TRAINING_DATA = 'qa_training_data'

def create_db_tables():
    """Crée les tables de la base de données si elles n'existent pas."""
    with engine.connect() as connection:
        connection.execute(text(f"""
            CREATE TABLE IF NOT EXISTS {TABLE_RAW_POSTS} (
                id TEXT PRIMARY KEY,
                date_post TEXT,
                author TEXT,
                title TEXT,
                selftext TEXT,
                url_image TEXT,
                subreddit TEXT,
                url_post TEXT,
                original_filename TEXT
            );
            CREATE TABLE IF NOT EXISTS {TABLE_PROCESSED_POSTS} (
                id TEXT PRIMARY KEY,
                raw_post_id TEXT REFERENCES {TABLE_RAW_POSTS}(id),
                vehicle_type TEXT,
                brand TEXT,
                model TEXT,
                year TEXT,
                problem TEXT,
                needs_comment_processing BOOLEAN,
                tout_les_commentaires TEXT,
                commentateurs_details_json TEXT,
                has_image BOOLEAN,
                image_description TEXT, -- NOUVEAU: Description de l'image
                has_significant_content BOOLEAN,
                is_ai_generated_consensus BOOLEAN,
                ai_diagnosis TEXT,
                ai_solution_steps_json TEXT,
                ai_parts_needed_json TEXT,
                consensus_des_commentaires TEXT,
                solution_steps_json TEXT,
                parts_needed_json TEXT,
                web_diagnosis TEXT,
                web_solution_steps_json TEXT,
                web_parts_needed_json TEXT,
                web_relevance_score REAL
            );
            CREATE TABLE IF NOT EXISTS {TABLE_DOCUMENT_METRICS} (
                metric_id SERIAL PRIMARY KEY,
                original_filename TEXT,
                file_start_date TEXT,
                file_end_date TEXT,
                total_rows INTEGER,
                lines_with_vehicle_info_percent REAL,
                lines_with_brand_percent REAL,
                lines_with_model_percent REAL,
                lines_with_year_percent REAL,
                lines_with_problem_percent REAL,
                lines_with_images_percent REAL,
                lines_with_image_description_percent REAL, -- NOUVEAU: pour les métriques
                lines_with_extracted_comments_percent REAL,
                lines_with_ai_consensus_percent REAL,
                lines_with_significant_content_percent REAL,
                top10_posts_by_author TEXT,
                top10_comments_by_commentator TEXT,
                top10_avg_karma_by_commentator TEXT
            );
            CREATE TABLE IF NOT EXISTS {TABLE_QA_TRAINING_DATA} (
                qa_id SERIAL PRIMARY KEY,
                post_id TEXT REFERENCES {TABLE_PROCESSED_POSTS}(id),
                system_prompt TEXT,
                question TEXT,
                answer TEXT
            );
        """))
        connection.commit()
    print("Vérification et création des tables de base de données terminées.")


def extract_vehicle_info(title, selftext, brands_dict, vehicle_types, problems):
    """
    Extrait les informations du véhicule (type, marque, modèle, année, problème)
    à partir du titre et du texte du post, en utilisant les dictionnaires fournis.
    """
    combined_text = f"{title} {selftext}".lower() if pd.notna(selftext) else title.lower()
    
    vehicle_type = None
    brand = None
    model = None
    year = None
    problem = None
    
    year_pattern = r'\b(19[5-9]\d|20[0-2]\d|2030)\b'
    year_match = re.search(year_pattern, combined_text)
    if year_match:
        year = year_match.group()
    
    for b, models in brands_dict.items():
        if b in combined_text or any(m in combined_text for m in models):
            brand = b
            for m in models:
                if m in combined_text and m != b:
                    model = m
                    break
            break
    
    for vt in vehicle_types:
        if vt in combined_text:
            vehicle_type = vt
            break
    
    if not vehicle_type and (brand or model):
        truck_brands = ['ford', 'chevrolet', 'gmc', 'dodge', 'ram', 'toyota', 'nissan']
        truck_models = ['f150', 'f250', 'f350', 'silverado', 'sierra', '1500', '2500', '3500', 'tundra', 'titan']
        car_brands = ['volkswagen', 'audi', 'bmw', 'mercedes']
        car_models = ['jetta', 'golf', 'passat', 'a3', 'a4', '335d', '328d']
        
        if brand in truck_brands or (model and any(tm in model for tm in truck_models)):
            vehicle_type = 'truck'
        elif brand in car_brands or (model and any(cm in model for cm in car_models)):
            vehicle_type = 'car'
    
    for p in problems:
        if p in combined_text:
            problem = p
            pattern = r'(\S+\s+){0,5}' + re.escape(p) + r'(\s+\S+){0,5}'
            context_match = re.search(pattern, combined_text)
            if context_match:
                problem = context_match.group().strip()
            break
    
    if not problem:
        question_patterns = [
            r'(what|how|why|is|can|does).{5,50}\?',
            r'(issue|problem|trouble).{5,50}',
            r'(need|looking).{5,50}(help|advice)',
            r'(not).{1,10}(working|running|starting)'
        ]
        
        for pattern in question_patterns:
            match = re.search(pattern, combined_text)
            if match:
                problem = match.group().strip()
                break
    
    return {
        'vehicle_type': vehicle_type,
        'brand': brand,
        'model': model,
        'year': year,
        'problem': problem
    }


def evaluer_commentaire(commentaire_json_string):
    """
    Évalue la pertinence et la crédibilité des commentaires à partir de la chaîne JSON.
    """
    if pd.isna(commentaire_json_string) or not commentaire_json_string.strip():
        return None
    
    try:
        comments_data = json.loads(commentaire_json_string)
        if not comments_data: # Aucune donnée de commentaire
            return None
    except json.JSONDecodeError:
        return None # Gérer les chaînes JSON invalides

    total_score_pertinence = 0
    total_score_credibilite = 0
    num_valid_comments = 0

    mots_cles_pertinence = ['problème', 'solution', 'réparation', 'expérience',
                          'diagnostic', 'symptôme', 'panne', 'mécanique', 'code erreur',
                          'fuite', 'fumée', 'bruit', 'perte de puissance', 'moteur', 'turbo', 'injecteur']

    indicateurs_credibilite = ['je suis mécanicien', 'j\'ai eu le même problème',
                              'selon le manuel', 'chez le concessionnaire',
                              'voici ma solution', 'années d\'expérience', 'mon expérience',
                              'conseil', 'fait ça', 'essayez', 'vérifiez', 'spécialiste',
                              'garage', 'outil', 'diagnostiquer']

    for comment_dict in comments_data:
        comment_body = comment_dict.get('body', '')
        if comment_body and comment_body.strip() != '[deleted]':
            commentaire_lower = comment_body.lower()
            total_score_pertinence += sum(1 for mot in mots_cles_pertinence if mot in commentaire_lower)
            total_score_credibilite += sum(1 for ind in indicateurs_credibilite if ind in commentaire_lower)
            num_valid_comments += 1

    if num_valid_comments > 0:
        return {
            'score_pertinence_total': total_score_pertinence,
            'score_credibilite_total': total_score_credibilite,
            'score_total_global': total_score_pertinence + total_score_credibilite,
            'nombre_commentaires_analyses': num_valid_comments
        }
    else:
        return None

def generer_consensus(row, is_ai_generated=False):
    """
    Génère un consensus textuel basé sur les commentaires extraits ou l'IA.
    """
    if is_ai_generated:
        return row['ai_diagnosis'] if pd.notna(row['ai_diagnosis']) else ""

    commentaire_json_string = row['commentateurs_details_json']
    if pd.isna(commentaire_json_string) or not commentaire_json_string.strip():
        return ""
    
    try:
        comments_data = json.loads(commentaire_json_string)
        if not comments_data:
            return ""
    except json.JSONDecodeError:
        return ""

    probleme = str(row['problem']) if pd.notna(row['problem']) else "un problème non spécifié"
    marque = str(row['brand']) if pd.notna(row['brand']) else "un véhicule"
    modele = str(row['model']) if pd.notna(row['model']) else ""
    annee = str(row['year']) if pd.notna(row['year']) else ""

    consensus_text = f"Concernant le problème '{probleme}' sur le véhicule {marque} {modele} {annee} : "
    solutions_proposees_concatenated = []
    
    for comment_dict in comments_data:
        comment_lower = comment_dict.get('body', '').lower()
        if not comment_lower or comment_lower == '[deleted]':
            continue 

        if "capteur de pression de carburant" in comment_lower:
            solutions_proposees_concatenated.append("vérification/remplacement du capteur de pression de carburant")
        if "egr" in comment_lower and "nettoyage" in comment_lower:
            solutions_proposees_concatenated.append("nettoyage de la vanne EGR")
        if "fumée bleue" in comment_lower and ("turbo" in comment_lower or "segment" in comment_lower):
            solutions_proposees_concatenated.append("inspection du turbo ou des segments de piston pour consommation d'huile")
        if "bougies de préchauffage" in comment_lower and "démarrage à froid" in comment_lower:
            solutions_proposees_concatenated.append("remplacement des bougies de préchauffage")
        if "fuites de carburant" in comment_lower and ("filtre" in comment_lower or "injecteurs" in comment_lower):
            solutions_proposees_concatenated.append("vérification des fuites au niveau du filtre à carburant ou des injecteurs")
        if "diesel" in comment_lower and "additif" in comment_lower:
            solutions_proposees_concatenated.append("utilisation d'un additif diesel pour nettoyer le système de carburant")
        if "dpf" in comment_lower and "regen" in comment_lower:
            solutions_proposees_concatenated.append("effectuer une régénération forcée du FAP")
        if "check engine" in comment_lower and "code" in comment_lower:
            solutions_proposees_concatenated.append("diagnostiquer avec un scanner OBD-II pour lire les codes d'erreur")

    if solutions_proposees_concatenated:
        solutions_uniques = list(set(solutions_proposees_concatenated))
        consensus_text += "l'analyse des commentaires suggère les solutions suivantes : " + ", ".join(solutions_uniques) + "."
    else:
        consensus_text += "les commentaires pertinents n'ont pas fourni de solutions claires."

    return consensus_text


def get_structured_solution_info(row, is_ai_generated=False):
    """
    Extrait les étapes de solution séquentielles et les pièces nécessaires.
    Priorise les informations générées par l'IA si disponibles.
    """
    if is_ai_generated:
        ai_steps = json.loads(row['ai_solution_steps_json']) if pd.notna(row['ai_solution_steps_json']) else []
        ai_parts = json.loads(row['ai_parts_needed_json']) if pd.notna(row['ai_parts_needed_json']) else []
        return ai_steps, ai_parts

    # Fallback to comment-based extraction if not AI generated
    comment_json_string = row['commentateurs_details_json']
    solution_steps_list = []
    parts_needed_list = []

    if pd.isna(comment_json_string) or not comment_json_string.strip():
        return [], []
    
    try:
        comments_data = json.loads(comment_json_string)
        if not comments_data:
            return [], []
    except json.JSONDecodeError:
        return [], []

    problem_lower = row['problem'].lower() if pd.notna(row['problem']) else ""

    # Concaténer tous les corps de commentaires pour une analyse plus large
    all_comments_body = " ".join([c.get('body', '') for c in comments_data if c.get('body') != '[deleted]']).lower()

    # --- Étapes Séquentielles (priorité et dépendance implicite) ---

    # 1. Diagnostic Initial
    step_counter = 1
    if "code erreur" in problem_lower or "check engine" in problem_lower or "diagnostiquer" in all_comments_body or "scan" in all_comments_body:
        solution_steps_list.append(f"{step_counter}. **Diagnostiquer** le problème en lisant les codes d'erreur via un scanner OBD-II.")
        step_counter += 1
    
    if "inspection visuelle" in all_comments_body or "vérifier les connexions" in all_comments_body or "visuel" in all_comments_body:
        solution_steps_list.append(f"{step_counter}. Effectuer une **inspection visuelle** détaillée des composants suspects et des raccordements.")
        step_counter += 1

    # 2. Identification des pièces en cause (basée sur les commentaires et le problème)
    identified_parts = set()
    if "capteur de pression de carburant" in all_comments_body or "capteur carburant" in all_comments_body:
        identified_parts.add("Capteur de pression de carburant")
        solution_steps_list.append(f"{step_counter}. **Vérifier le capteur de pression de carburant** (valeurs, câblage) et le remplacer si défectueux.")
        step_counter += 1
    if "egr" in all_comments_body:
        identified_parts.add("Vanne EGR")
        solution_steps_list.append(f"{step_counter}. **Nettoyer ou remplacer la vanne EGR** et s'assurer du bon fonctionnement des conduits.")
        step_counter += 1
    if "turbo" in all_comments_body or "fumée bleue" in problem_lower or "consommation d'huile" in all_comments_body:
        identified_parts.add("Turbo")
        solution_steps_list.append(f"{step_counter}. **Inspecter le turbo** (jeu, fuites d'huile) et envisager un remplacement ou une réparation.")
        step_counter += 1
    if "bougies de préchauffage" in all_comments_body or "démarrage à froid" in problem_lower:
        identified_parts.add("Bougies de préchauffage")
        solution_steps_list.append(f"{step_counter}. **Tester les bougies de préchauffage** et les remplacer si elles sont usées.")
        step_counter += 1
    if "injecteur" in all_comments_body or "fuite carburant" in problem_lower:
        identified_parts.add("Injecteur(s) de carburant")
        solution_steps_list.append(f"{step_counter}. **Tester les injecteurs** (débit, pulvérisation) et les remplacer si nécessaire.")
        step_counter += 1
    if "dpf" in all_comments_body or "filtre à particules" in all_comments_body:
        identified_parts.add("Filtre à particules (FAP)")
        solution_steps_list.append(f"{step_counter}. **Vérifier l'état du FAP** et, si obstrué, procéder à une régénération forcée ou un nettoyage.")
        step_counter += 1
    if "filtre à carburant" in all_comments_body:
        identified_parts.add("Filtre à carburant")
        solution_steps_list.append(f"{step_counter}. **Remplacer le filtre à carburant**.")
        step_counter += 1
    if "pompe" in all_comments_body and ("carburant" in all_comments_body or "haute pression" in all_comments_body):
        identified_parts.add("Pompe à carburant")
        solution_steps_list.append(f"{step_counter}. **Contrôler la pompe à carburant** et sa pression de sortie.")
        step_counter += 1

    # 3. Vérification post-intervention et rappels génériques
    solution_steps_list.append(f"{step_counter}. **Rappel :** Avant de commander, **vérifiez la disponibilité des pièces** et leur compatibilité exacte avec votre modèle (année, motorisation).")
    step_counter += 1
    solution_steps_list.append(f"{step_counter}. **Rappel :** Pour le remplacement des pièces, référez-vous à la **procédure étape par étape** du manuel de réparation ou d'une source fiable.")
    step_counter += 1
    solution_steps_list.append(f"{step_counter}. **Rappel :** Après toute intervention, effectuez un **double-check** de toutes les connexions et du serrage des composants.")
    step_counter += 1
    solution_steps_list.append(f"{step_counter}. **Finalisation :** Effacer les codes d'erreur et réaliser un essai routier pour confirmer la résolution du problème.")
    
    parts_needed_list = list(identified_parts)
    
    # S'assurer que les étapes sont uniques et dans un ordre logique (si possible)
    final_solution_steps = []
    seen_steps_content = set()
    for step in solution_steps_list:
        # Extraire le contenu de l'étape sans le numéro pour la déduplication
        step_content = re.sub(r'^\d+\.\s*', '', step).strip()
        if step_content not in seen_steps_content:
            final_solution_steps.append(step)
            seen_steps_content.add(step_content)

    # Ré-numérotation finale pour s'assurer de la séquence
    renumbered_steps = []
    for i, step in enumerate(final_solution_steps):
        # Enlève l'ancien numéro et le ré-ajoute
        content = re.sub(r'^\d+\.\s*', '', step).strip()
        renumbered_steps.append(f"{i+1}. {content}")

    return renumbered_steps, list(parts_needed_list)


def suggest_dictionary_refinements(df_processed, brands_dict_current, vehicle_types_current, problems_current):
    """
    Suggère des termes pour affiner les dictionnaires d'extraction
    en se basant sur les données non identifiées dans le DataFrame.
    """
    suggested_brands = set()
    suggested_models = set()
    suggested_vehicle_types = set()
    suggested_problems = set()

    for _, row in df_processed.iterrows():
        title = str(row['title']).lower() if pd.notna(row['title']) else ""
        selftext = str(row['selftext']).lower() if pd.notna(row['selftext']) else ""
        combined_text = f"{title} {selftext}"

        # Suggérer de nouvelles marques/modèles/types non identifiés mais potentiellement présents
        # Cible les cas où notre extraction n'a rien trouvé mais le texte contient des mots-clés qui pourraient être utiles
        
        # Suggestions de marques
        if pd.isna(row['brand']):
            # Rechercher des mots qui ressemblent à des marques non encore capturées
            potential_brands_in_text = re.findall(r'\b(?:ford|dodge|chevy|volkswagen|mercedes|bmw|audi|toyota|nissan|detroit|cummins|duramax|paccar|cat)\b', combined_text)
            for pb in potential_brands_in_text:
                if pb not in [k.lower() for k in brands_dict_current.keys()]:
                    suggested_brands.add(pb)

        # Suggestions de modèles (spécifiques à une marque si la marque a été identifiée)
        if pd.isna(row['model']) and pd.notna(row['brand']):
            brand_lower = row['brand'].lower()
            # Rechercher des mots qui pourraient être des modèles pour la marque identifiée
            for model_candidate in re.findall(r'\b\w+\b', combined_text): # Tous les mots
                if len(model_candidate) > 1 and model_candidate not in [m.lower() for sublist in brands_dict_current.values() for m in sublist]:
                    # Heuristique simple: si c'est un mot alphanumérique qui n'est pas déjà un modèle
                    # et qu'il apparaît après la marque, il pourrait être un modèle.
                    if brand_lower in combined_text and combined_text.find(model_candidate) > combined_text.find(brand_lower):
                        suggested_models.add(f"{brand_lower}: {model_candidate}")

        # Suggestions de types de véhicules
        if pd.isna(row['vehicle_type']):
            # Rechercher des mots qui ressemblent à des types de véhicules non encore capturés
            potential_types_in_text = re.findall(r'\b(?:truck|pickup|semi|tractor|trailer|sedan|suv|van|car)\b', combined_text)
            for pt in potential_types_in_text:
                if pt not in [v.lower() for v in vehicle_types_current]:
                    suggested_vehicle_types.add(pt)
        
        # Suggérer de nouveaux problèmes non identifiés
        if pd.isna(row['problem']) and combined_text:
            # Rechercher des phrases autour de "issue", "problem", "fault", "error", "not working"
            problem_patterns = [
                r'(?:issue|problem|fault|error|not working|not starting|no power) (?:with )?([\w\s]{5,40})',
                r'([^.]{10,80}? (?:trouble|symptom|diagnostic))' # Une phrase avec un mot clé de problème
            ]
            for pattern in problem_patterns:
                matches = re.findall(pattern, combined_text)
                for m in matches:
                    if isinstance(m, tuple): # If pattern has groups
                        m = m[0]
                    clean_match = m.strip()
                    if clean_match and clean_match not in [p.lower() for p in problems_current]:
                        suggested_problems.add(clean_match)
            
            # Si le problème n'a pas été identifié, la 'selftext' ou le 'title' peuvent contenir la description
            if pd.isna(row['problem']) and pd.notna(row['selftext']):
                # Simple: si aucun problème n'a été trouvé, les 10-20 premiers mots du selftext peuvent être une suggestion
                first_words = " ".join(selftext.split()[:20])
                if first_words and first_words not in [p.lower() for p in problems_current]:
                    suggested_problems.add(first_words + "...") # Indique que c'est tronqué


    return {
        'suggested_brands': sorted(list(suggested_brands)),
        'suggested_models': sorted(list(suggested_models)),
        'suggested_vehicle_types': sorted(list(suggested_vehicle_types)),
        'suggested_problems': sorted(list(suggested_problems))
    }

def analyze_image_with_ai(image_url: str, post_context: dict):
    """
    Détecte, analyse et met en évidence des aspects de l'image en contexte avec le post.
    Simule l'appel à un modèle de vision IA (gemini-2.0-flash).
    """
    print(f"Analyse de l'image pour: {post_context.get('problem', 'N/A')} (URL: {image_url})...")

    # --- Simuler la récupération de l'image en base64 ---
    # Dans une vraie application, vous feriez une requête HTTP pour télécharger l'image
    # et la convertiriez en base64. Pour cette simulation, on utilise une image base64 factice.
    # Remplacez ceci par votre vraie logique de téléchargement/conversion si nécessaire.
    dummy_base64_image = base64.b64encode(b"dummy image data").decode('utf-8')
    # Ou utilisez une petite image réelle encodée en base64 si vous avez une pour les tests.

    # --- Prompt pour le modèle de vision IA ---
    # Le prompt demande à l'IA de se concentrer sur le problème et le véhicule mentionnés.
    vision_prompt = f"""
    Analysez l'image fournie dans le contexte suivant :
    - Problème mentionné dans le post : {post_context.get('problem', 'Non spécifié')}
    - Véhicule : {post_context.get('brand', 'N/A')} {post_context.get('model', 'N/A')} {post_context.get('year', 'N/A')}
    - Contenu du post : {post_context.get('title', '')} {post_context.get('selftext', '')}

    Décrivez en détail ce que vous voyez dans l'image, en mettant particulièrement l'accent sur :
    1.  Toute pièce de véhicule diesel visible (moteur, turbo, injecteurs, conduites de carburant, DPF, etc.).
    2.  Tout signe de problème (fuite de liquide, fumée, corrosion, usure anormale, câbles déconnectés, dommages).
    3.  Le contexte général de l'image (est-ce un garage, sous le capot, le véhicule entier ?).
    4.  Tout élément qui pourrait confirmer ou infirmer le problème mentionné dans le post.
    La description doit être précise, technique si possible, et directement pertinente au diagnostic du problème.
    """

    # --- Simuler l'appel à l'API Gemini Vision ---
    # Dans un environnement réel, vous feriez une requête POST à l'API Gemini Vision
    # avec l'image encodée en base64 et le prompt.
    # Exemple de payload (simplifié pour le mock):
    # payload = {
    #     "contents": [
    #         {"role": "user", "parts": [{"text": vision_prompt}]},
    #         {"role": "user", "parts": [{"inlineData": {"mimeType": "image/jpeg", "data": dummy_base64_image}}]}
    #     ]
    # }
    # response = requests.post(gemini_api_url, json=payload)
    # result = response.json()
    # image_description = result['candidates'][0]['content']['parts'][0]['text']

    print("MOCK: Simulating Gemini Vision API call for image analysis...")
    simulated_ai_image_description = f"""
    Description de l'image simulée :
    L'image semble montrer un compartiment moteur de véhicule diesel. On peut distinguer [un composant spécifique, ex: le filtre à carburant] et des [conduites]. Il y a des traces de [liquide sombre/rouille] sous le [composant mentionné], ce qui pourrait indiquer une [fuite/corrosion]. Le [moteur] semble [propre/sale], et on ne voit pas de fumée visible sur cette vue. Cela est pertinent pour le problème de '{post_context.get('problem', '')}' car cela montre une zone potentiellement affectée par une fuite. L'image est prise [sous le capot/dans un garage].
    """.strip()

    return simulated_ai_image_description


def perform_web_research_and_score(problem_description, vehicle_info, post_content):
    """
    Performe une recherche web, récupère des solutions, visualise des vidéos et priorise des sites.
    Retourne un diagnostic web, des étapes de solution, des pièces et un score de pertinence.
    """
    print(f"Lancement de la recherche web pour: {problem_description} ({vehicle_info.get('brand', 'N/A')} {vehicle_info.get('model', 'N/A')})...")

    web_diagnosis = ""
    web_solution_steps = []
    web_parts_needed = []
    relevance_score = 0.0

    # Prioriser ces domaines
    PRIORITIZED_DOMAINS = [
        "youtube.com", "reddit.com", "forums.dieselplace.com", "f150forum.com",
        "dieseltechmagazine.com", "gmc.com", "ford.com", "chevrolet.com", "vw.com",
        "audi.com", "bmw.com", "mercedes-benz.com", "toyota.com", "nissan.com",
        "autozone.com", "oreillyauto.com", "napaonline.com", "rockauto.com" # Exemples de sites de pièces/informations techniques
    ]

    # --- Search Queries ---
    search_queries = [
        f"solution {problem_description} {vehicle_info.get('brand', '')} {vehicle_info.get('model', '')} diesel",
        f"{vehicle_info.get('brand', '')} {vehicle_info.get('model', '')} {problem_description} réparation vidéo",
        f"{problem_description} {vehicle_info.get('brand', '')} {vehicle_info.get('model', '')} forum discussion",
        f"diagnostic {problem_description} {vehicle_info.get('brand', '')} {vehicle_info.get('model', '')} pdf"
    ]

    all_snippets = []
    all_urls = []
    try:
        search_results = google_search_search(queries=search_queries)
        for res in search_results:
            if res.results:
                for item in res.results:
                    if item.snippet:
                        all_snippets.append(item.snippet)
                        all_urls.append(item.url)
    except Exception as e:
        print(f"Erreur lors de la recherche web avec google_search: {e}")

    # --- Analyze Snippets and URLs for Solutions and Scoring ---
    temp_solution_steps = set()
    temp_parts_needed = set()
    found_info_score = 0

    for i, snippet in enumerate(all_snippets):
        url = all_urls[i] if i < len(all_urls) else ""
        snippet_lower = snippet.lower()
        url_lower = url.lower()

        # Score based on prioritized domains
        for domain in PRIORITIZED_DOMAINS:
            if domain in url_lower:
                relevance_score += 0.5 # Boost for trusted/relevant sites

        # Extract potential solutions/parts from snippets
        if "vérifier" in snippet_lower or "tester" in snippet_lower or "remplacer" in snippet_lower or "nettoyer" in snippet_lower:
            found_info_score += 0.2
            if "capteur" in snippet_lower: temp_solution_steps.add("Vérifier/tester le capteur [spécifique si mentionné].")
            if "injecteur" in snippet_lower: temp_solution_steps.add("Tester et potentiellement remplacer les injecteurs.")
            if "egr" in snippet_lower: temp_solution_steps.add("Nettoyer ou remplacer la vanne EGR.")
            if "dpf" in snippet_lower or "fap" in snippet_lower: temp_solution_steps.add("Diagnostiquer le FAP et effectuer une régénération si nécessaire.")
            if "turbo" in snippet_lower: temp_solution_steps.add("Inspecter le turbo pour un jeu excessif ou des fuites.")

            if "capteur" in snippet_lower and "remplacement" in snippet_lower: temp_parts_needed.add("Capteur [spécifique]")
            if "injecteur" in snippet_lower and "remplacement" in snippet_lower: temp_parts_needed.add("Injecteur(s)")
            if "vanne egr" in snippet_lower: temp_parts_needed.add("Vanne EGR")
            if "filtre" in snippet_lower: temp_parts_needed.add("Filtre [carburant/air/huile]")


    web_solution_steps = list(temp_solution_steps)
    web_parts_needed = list(temp_parts_needed)

    # Basic web diagnosis summary
    if web_solution_steps:
        web_diagnosis = f"La recherche web suggère un diagnostic et des solutions potentielles pour le problème de '{problem_description}'. Les étapes clés incluent : " + ", ".join(web_solution_steps[:2]) + "."
    elif all_snippets:
        web_diagnosis = f"La recherche web a trouvé des discussions autour de '{problem_description}' sur des véhicules similaires, avec des mentions de : {all_snippets[0][:100]}..."

    relevance_score += found_info_score # Add score for finding actionable info

    # Ensure steps are numbered
    renumbered_steps = []
    if web_solution_steps:
        for i, step in enumerate(web_solution_steps):
            renumbered_steps.append(f"{i+1}. {step}")

    return web_diagnosis, renumbered_steps, web_parts_needed, relevance_score

def get_best_consensus_and_solutions(row):
    """
    Détermine la meilleure source pour le diagnostic, les étapes et les pièces pour le JSONL final.
    Priorité : IA > Commentaires PRAW > Recherche Web.
    """
    if row['is_ai_generated_consensus']:
        return (row['ai_diagnosis'], 
                json.loads(row['ai_solution_steps_json']) if pd.notna(row['ai_solution_steps_json']) else [],
                json.loads(row['ai_parts_needed_json']) if pd.notna(row['ai_parts_needed_json']) else [],
                "IA_Generated")
    
    # Check for PRAW comments
    has_valid_comments = pd.notna(row['tout_les_commentaires']) and \
                         row['tout_les_commentaires'].strip() != "" and \
                         "ERREUR_PRAW" not in str(row['tout_les_commentaires']) and \
                         "ID_POST_NON_TROUVE" not in str(row['tout_les_commentaires']) and \
                         "PENDING_COMMENTS_DELAY" not in str(row['tout_les_commentaires'])

    if has_valid_comments:
        return (generer_consensus(row, is_ai_generated=False),
                get_structured_solution_info(row, is_ai_generated=False)[0],
                get_structured_solution_info(row, is_ai_generated=False)[1],
                "PRAW_Comments")
    
    # Fallback to Web Research if available
    if pd.notna(row['web_diagnosis']) and row['web_diagnosis'].strip() != "" and row['web_relevance_score'] > 0:
        return (row['web_diagnosis'],
                json.loads(row['web_solution_steps_json']) if pd.notna(row['web_solution_steps_json']) else [],
                json.loads(row['web_parts_needed_json']) if pd.notna(row['web_parts_needed_json']) else [],
                "Web_Research")
    
    return ("", [], [], "No_Info") # Default empty if no info


def process_single_post_data(post_data: dict, output_base_dir="/home/user/output"):
    """
    Traite les données d'un seul post Reddit reçu via webhook.
    """
    df_input = pd.DataFrame([post_data])
    
    df_input.rename(columns={
        'Selftext': 'selftext',
        'Réponse de Chatgpt': 'reponse_chatgpt',
        'MOTS CLE': 'mots_cle',
        'NOMBRE DE COMMENTAIRES': 'nombre_de_commentaires',
        'cONSENSUS DES COMMENTAIRES': 'consensus_des_commentaires',
        'TOUT LES COMMENTAIRES': 'tout_les_commentaires',
        'Unnamed: 13': 'unnamed_13',
        'CreatedAt': 'date_post',
        'AuthorName': 'author',
        'Content': 'selftext',
        'ImageUrl': 'url_image',
        'Subreddit': 'subreddit',
        'PostId': 'id',
        'PostUrl': 'url_post'
    }, inplace=True)

    required_cols_raw = ['date_post', 'author', 'title', 'selftext', 'url_image', 'subreddit', 'id', 'url_post']
    for col in required_cols_raw:
        if col not in df_input.columns:
            df_input[col] = np.nan

    if 'id' not in df_input.columns or pd.isna(df_input['id'].iloc[0]) or df_input['id'].duplicated().any():
        print("L'ID du post est manquant, nul ou dupliqué. Génération d'un ID unique.")
        df_input['id'] = 'post_' + str(uuid.uuid4())
    else:
        df_input['id'] = df_input['id'].astype(str)

    original_filename_simulated = f"post_{df_input.iloc[0]['id']}.csv"
    print(f"\nTraitement du post unique : {df_input.iloc[0]['id']} from {original_filename_simulated}")

    df_processed_single = df_input.copy()
    
    output_cols_init = {
        'vehicle_type': None, 'brand': None, 'model': None, 'year': None, 'problem': None,
        'needs_comment_processing': False, 'tout_les_commentaires': "", 'commentateurs_details_json': "",
        'has_image': False, 'image_description': None, # Nouvelle colonne ici
        'has_significant_content': False, 'is_ai_generated_consensus': False,
        'ai_diagnosis': None, 'ai_solution_steps_json': None, 'ai_parts_needed_json': None,
        'consensus_des_commentaires': "", 'solution_steps_json': "", 'parts_needed_json': "",
        'web_diagnosis': None, 'web_solution_steps_json': None, 'web_parts_needed_json': None, 'web_relevance_score': 0.0
    }
    for col, default_val in output_cols_init.items():
        if col not in df_processed_single.columns:
            df_processed_single[col] = default_val

    # --- Enregistrer les données brutes dans la table raw_posts ---
    raw_posts_cols = ['id', 'date_post', 'author', 'title', 'selftext', 'url_image', 'subreddit', 'url_post']
    df_raw_for_db = df_processed_single[raw_posts_cols].copy()
    df_raw_for_db['original_filename'] = original_filename_simulated
    
    try:
        with engine.connect() as connection:
            for index, row in df_raw_for_db.iterrows():
                row_dict = row.to_dict()
                columns = ', '.join(row_dict.keys())
                placeholders = ', '.join([f":{col}" for col in row_dict.keys()])
                update_set = ', '.join([f"{col} = :{col}" for col in row_dict.keys() if col != 'id'])

                query = text(f"""
                    INSERT INTO {TABLE_RAW_POSTS} ({columns}) VALUES ({placeholders})
                    ON CONFLICT (id) DO UPDATE SET {update_set};
                """)
                connection.execute(query, row_dict)
            connection.commit()
        print(f"Données brutes du post '{df_input.iloc[0]['id']}' insérées/mises à jour dans la table '{TABLE_RAW_POSTS}'.")
    except Exception as e:
        print(f"Erreur lors de l'insertion/mise à jour des données brutes du post dans la DB: {e}")
        return None, None 

    try:
        df_processed_single['date_post_dt'] = pd.to_datetime(df_processed_single['date_post'], format='%B %d, %Y at %I:%M%p', errors='coerce')
        valid_dates = df_processed_single['date_post_dt'].dropna()
        if not valid_dates.empty:
            first_date = valid_dates.min().strftime('%Y-%m-%d')
            last_date = valid_dates.max().strftime('%Y-%m-%d')
            folder_name = f"{first_date}_to_{last_date}_{os.path.splitext(original_filename_simulated)[0]}"
        else:
            raise ValueError("Aucune date valide trouvée pour nommer le dossier.")
    except Exception as e:
        print(f"Erreur lors de la détermination des dates pour le nom du dossier : {e}. Utilisation d'un nom par défaut.")
        folder_name = f"processed_{os.path.splitext(original_filename_simulated)[0]}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    
    current_output_dir = os.path.join(output_base_dir, folder_name)
    os.makedirs(current_output_dir, exist_ok=True)
    print(f"Dossier de sortie local créé pour ce fichier (éphémère sur Render) : {current_output_dir}")

    for idx, row in df_processed_single.iterrows():
        title = row['title'] if pd.notna(row['title']) else ""
        selftext = row['selftext'] if pd.notna(row['selftext']) else ""
        
        info = extract_vehicle_info(title, selftext, BRANDS_DICT, VEHICLE_TYPES, PROBLEMS)
        
        df_processed_single.at[idx, 'vehicle_type'] = info['vehicle_type']
        df_processed_single.at[idx, 'brand'] = info['brand']
        df_processed_single.at[idx, 'model'] = info['model']
        df_processed_single.at[idx, 'year'] = info['year']
        df_processed_single.at[idx, 'problem'] = info['problem']
        
        url = row['url_post']
        if pd.notna(url) and 'reddit.com' in str(url):
            df_processed_single.at[idx, 'needs_comment_processing'] = True
        
        if pd.notna(row['url_image']) and str(row['url_image']).strip() != '#REF!' and 'http' in str(row['url_image']).lower():
            df_processed_single.at[idx, 'has_image'] = True

    # --- NOUVEAU: Analyse d'images avec IA ---
    for index, row in df_processed_single.iterrows():
        if row['has_image'] and pd.notna(row['url_image']) and pd.notna(row['problem']):
            post_context_for_image_analysis = {
                "title": row['title'],
                "selftext": row['selftext'],
                "problem": row['problem'],
                "brand": row['brand'],
                "model": row['model'],
                "year": row['year']
            }
            # ATTENTION: La récupération et l'encodage base64 de l'image sont simulés ici.
            # Implémentez votre propre logique pour un déploiement réel.
            image_desc = analyze_image_with_ai(row['url_image'], post_context_for_image_analysis)
            df_processed_single.at[index, 'image_description'] = image_desc
            print(f"Description de l'image générée pour le post {row['id']}.")
        elif row['has_image'] and pd.isna(row['problem']):
            print(f"Image détectée pour le post {row['id']} mais pas de problème, analyse d'image skippée.")

    # --- Étape 5: Extraction des commentaires Reddit à l'aide de PRAW (avec délai) ---
    df_to_process_comments = df_processed_single[
        (df_processed_single['needs_comment_processing'] == True) &
        df_processed_single['url_post'].notna() &
        df_processed_single['url_post'].astype(str).str.contains('reddit.com/r/')
    ].copy()

    print(f"Début de l'extraction des commentaires pour {len(df_to_process_comments)} posts...")

    current_time = datetime.now()
    
    for index, row in df_to_process_comments.iterrows():
        post_date_str = row['date_post']
        try:
            post_datetime = datetime.strptime(post_date_str, '%B %d, %Y at %I:%M%p')
            days_since_post = (current_time - post_datetime).days
        except ValueError:
            print(f"Impossible de parser la date du post '{post_date_str}'. Skip PRAW for this one.")
            df_processed_single.at[index, 'tout_les_commentaires'] = "DATE_PARSE_ERROR"
            df_processed_single.at[index, 'commentateurs_details_json'] = json.dumps([])
            days_since_post = -1

        if days_since_post >= MIN_DAYS_FOR_COMMENTS:
            url = str(row['url_post'])
            post_id_match = re.search(r'reddit\.com/r/[^/]+/comments/([^/]+)/', url)
            if post_id_match:
                post_id = post_id_match.group(1)
                try:
                    submission = reddit.submission(id=post_id)
                    submission.comments.replace_more(limit=0)
                    
                    comments_raw = []
                    commentators_details = []

                    for comment in submission.comments.list():
                        if comment.body and comment.body.strip() != '[deleted]':
                            comments_raw.append(comment.body)
                            comment_author_name = comment.author.name if comment.author else "[deleted]"
                            comment_author_karma = comment.author.comment_karma if comment.author else 0
                            commentators_details.append({
                                'body': comment.body,
                                'author': comment_author_name,
                                'comment_karma': comment_author_karma
                            })
                    df_processed_single.at[index, 'tout_les_commentaires'] = " ||| ".join(comments_raw)
                    df_processed_single.at[index, 'commentateurs_details_json'] = json.dumps(commentators_details, ensure_ascii=False)
                    time.sleep(1)
                except Exception as e:
                    df_processed_single.at[index, 'tout_les_commentaires'] = f"ERREUR_PRAW: {e}"
                    df_processed_single.at[index, 'commentateurs_details_json'] = json.dumps([])
                    print(f"Erreur lors de l'extraction des commentaires pour {url}: {e}")
            else:
                df_processed_single.at[index, 'tout_les_commentaires'] = "ID_POST_NON_TROUVE"
                df_processed_single.at[index, 'commentateurs_details_json'] = json.dumps([])
        else:
            df_processed_single.at[index, 'tout_les_commentaires'] = "PENDING_COMMENTS_DELAY"
            df_processed_single.at[index, 'commentateurs_details_json'] = json.dumps([])
            print(f"Commentaires non récupérés pour le post {row['id']}: délai de 14 jours non atteint (jours écoulés: {days_since_post}).")
    
    print("Extraction des commentaires (avec délai) terminée.")

    # --- Branche Indépendante: Recherche Web et Scoring ---
    print("\nLancement de la branche de recherche web indépendante...")
    for index, row in df_processed_single.iterrows():
        problem_val = row['problem']
        if pd.notna(problem_val) and problem_val.strip():
            vehicle_info_for_web = {
                "type": row['vehicle_type'], "brand": row['brand'], "model": row['model'], "year": row['year']
            }
            web_diag, web_steps, web_parts, web_score = perform_web_research_and_score(
                problem_val, vehicle_info_for_web, f"{row['title']} {row['selftext']}"
            )
            df_processed_single.at[index, 'web_diagnosis'] = web_diag
            df_processed_single.at[index, 'web_solution_steps_json'] = json.dumps(web_steps, ensure_ascii=False)
            df_processed_single.at[index, 'web_parts_needed_json'] = json.dumps(web_parts, ensure_ascii=False)
            df_processed_single.at[index, 'web_relevance_score'] = web_score
        else:
            print(f"Pas de problème identifié pour le post {row['id']}, skip recherche web.")

    # --- Fallback IA pour les posts sans commentaires significatifs ---
    print("\nApplication du fallback IA pour les posts sans commentaires...")
    global_df_for_ai = pd.read_sql_table(TABLE_PROCESSED_POSTS, engine) if engine.has_table(TABLE_PROCESSED_POSTS) else pd.DataFrame()

    for index, row in df_processed_single.iterrows():
        has_significant_comments = pd.notna(row['tout_les_commentaires']) and \
                                   row['tout_les_commentaires'].strip() != "" and \
                                   "ERREUR_PRAW" not in str(row['tout_les_commentaires']) and \
                                   "ID_POST_NON_TROUVE" not in str(row['tout_les_commentaires']) and \
                                   "PENDING_COMMENTS_DELAY" not in str(row['tout_les_commentaires'])

        if not has_significant_comments and pd.notna(row['problem']) and pd.notna(row['title']):
            vehicle_info_for_ai = {
                "type": row['vehicle_type'], "brand": row['brand'], "model": row['model'], "year": row['year']
            }
            
            # Enrichir le post_content avec la description de l'image si disponible
            enriched_post_content = f"{row['title']} {row['selftext']}"
            if pd.notna(row['image_description']) and row['image_description'].strip():
                enriched_post_content += f"\n\nDescription de l'image : {row['image_description']}"

            ai_response = generate_ai_response(
                problem_description=row['problem'],
                vehicle_info=vehicle_info_for_ai,
                post_content=enriched_post_content, # Contenu enrichi
                global_df_so_far_for_ai=global_df_for_ai
            )
            df_processed_single.at[index, 'is_ai_generated_consensus'] = True
            df_processed_single.at[index, 'ai_diagnosis'] = ai_response['diagnosis']
            df_processed_single.at[index, 'ai_solution_steps_json'] = json.dumps(ai_response['solution_steps'], ensure_ascii=False)
            df_processed_single.at[index, 'ai_parts_needed_json'] = json.dumps(ai_response['parts_needed'], ensure_ascii=False)
            print(f"Consensus IA généré pour le post ID {row['id']}.")


    # --- Classification du contenu significatif (mis à jour après fallback IA) ---
    for idx, row in df_processed_single.iterrows():
        has_problem_identified = pd.notna(row['problem']) and row['problem'].strip() != ""
        has_extracted_comments = pd.notna(row['tout_les_commentaires']) and row['tout_les_commentaires'].strip() != "" and "ERREUR_PRAW" not in str(row['tout_les_commentaires']) and "ID_POST_NON_TROUVE" not in str(row['tout_les_commentaires']) and "PENDING_COMMENTS_DELAY" not in str(row['tout_les_commentaires'])
        has_ai_consensus = row['is_ai_generated_consensus']
        has_web_solutions = pd.notna(row['web_diagnosis']) and row['web_diagnosis'].strip() != "" and row['web_relevance_score'] > 0
        has_image = row['has_image']
        
        if has_problem_identified or has_extracted_comments or has_ai_consensus or has_web_solutions or has_image:
            df_processed_single.at[idx, 'has_significant_content'] = True
    

    # --- Génération du consensus final et des étapes structurées (priorise IA > PRAW > Web) ---
    for idx, row in df_processed_single.iterrows():
        final_diagnosis, final_steps, final_parts, source_used = get_best_consensus_and_solutions(row)
        df_processed_single.at[idx, 'consensus_des_commentaires'] = final_diagnosis
        df_processed_single.at[idx, 'solution_steps_json'] = json.dumps(final_steps, ensure_ascii=False)
        df_processed_single.at[idx, 'parts_needed_json'] = json.dumps(final_parts, ensure_ascii=False)


    # --- Enregistrer les fichiers filtrés LOCALEMENT (éphémère sur Render) ---
    df_with_images = df_processed_single[df_processed_single['has_image']].copy()
    df_without_comments_or_ai_consensus = df_processed_single[
        (df_processed_single['tout_les_commentaires'].isna()) | 
        (df_processed_single['tout_les_commentaires'].eq('')) |
        (df_processed_single['tout_les_commentaires'].str.contains('ERREUR_PRAW')) |
        (df_processed_single['tout_les_commentaires'].eq('ID_POST_NON_TROUVE')) |
        (df_processed_single['tout_les_commentaires'].eq('PENDING_COMMENTS_DELAY'))
    ].copy()
    
    df_without_relevant_consensus_source = df_processed_single[
        (df_processed_single['consensus_des_commentaires'].isna()) |
        (df_processed_single['consensus_des_commentaires'].eq('')) |
        (df_processed_single['consensus_des_commentaires'].str.contains("un problème non spécifié"))
    ].copy()


    df_with_images.to_csv(os.path.join(current_output_dir, "lignes_avec_images.csv"), index=False)
    df_without_comments_or_ai_consensus.to_csv(os.path.join(current_output_dir, "lignes_sans_commentaires_ni_ai.csv"), index=False)
    df_without_relevant_consensus_source.to_csv(os.path.join(current_output_dir, "lignes_sans_consensus_pertinent.csv"), index=False)
    print(f"Fichiers filtrés LOCALEMENT (images, commentaires/IA, consensus pertinent) enregistrés dans {current_output_dir}.")

    # --- Métriques par CSV d'origine pour la table document_metrics ---
    metrics_data = {
        'original_filename': original_filename_simulated,
        'file_start_date': first_date if 'first_date' in locals() else 'N/A',
        'file_end_date': last_date if 'last_date' in locals() else 'N/A',
        'total_rows': len(df_processed_single),
        'lines_with_vehicle_info_percent': round(df_processed_single['vehicle_type'].notna().sum() / len(df_processed_single) * 100, 2),
        'lines_with_brand_percent': round(df_processed_single['brand'].notna().sum() / len(df_processed_single) * 100, 2),
        'lines_with_model_percent': round(df_processed_single['model'].notna().sum() / len(df_processed_single) * 100, 2),
        'lines_with_year_percent': round(df_processed_single['year'].notna().sum() / len(df_processed_single) * 100, 2),
        'lines_with_problem_percent': round(df_processed_single['problem'].notna().sum() / len(df_processed_single) * 100, 2),
        'lines_with_images_percent': round(df_processed_single['has_image'].sum() / len(df_processed_single) * 100, 2),
        'lines_with_image_description_percent': round(df_processed_single['image_description'].notna().sum() / len(df_processed_single) * 100, 2), # Nouvelle métrique
        'lines_with_extracted_comments_percent': round((df_processed_single['commentateurs_details_json'].apply(lambda x: bool(x) and 'ERREUR' not in str(x) and 'ID_POST_NON_TROUVE' not in str(x) and 'PENDING_COMMENTS_DELAY' not in str(x)).sum()) / len(df_processed_single) * 100, 2),
        'lines_with_ai_consensus_percent': round(df_processed_single['is_ai_generated_consensus'].sum() / len(df_processed_single) * 100, 2),
        'lines_with_web_research_solutions_percent': round((df_processed_single['web_diagnosis'].notna() & (df_processed_single['web_relevance_score'] > 0)).sum() / len(df_processed_single) * 100, 2),
        'lines_with_significant_content_percent': round(df_processed_single['has_significant_content'].sum() / len(df_processed_single) * 100, 2),
    }

    top10_authors = df_processed_single['author'].value_counts().head(10).to_dict()
    metrics_data['top10_posts_by_author'] = json.dumps(top10_authors)

    commenter_stats_single = {}
    for _, row in df_processed_single.iterrows():
        comment_json_string = row['commentateurs_details_json']
        if pd.notna(comment_json_string) and comment_json_string.strip():
            try:
                comments_details = json.loads(comment_json_string)
                for comment_dict in comments_details:
                    author_name = comment_dict.get('author')
                    author_karma = comment_dict.get('comment_karma', 0)
                    if author_name and author_name != '[deleted]':
                        if author_name not in commenter_stats_single:
                            commenter_stats_single[author_name] = {'count': 0, 'total_karma': 0}
                        commenter_stats_single[author_name]['count'] += 1
                        commenter_stats_single[author_name]['total_karma'] += author_karma
            except json.JSONDecodeError:
                pass
    
    commenters_df_single = pd.DataFrame.from_dict(commenter_stats_single, orient='index').reset_index()
    if not commenters_df_single.empty:
        commenters_df_single.columns = ['commentateur', 'nombre_commentaires', 'karma_total']
        commenters_df_single['notoriete_moyenne_karma'] = commenters_df_single['karma_total'] / commenters_df_single['nombre_commentaires']
        commenters_df_single = commenters_df_single.sort_values(by='nombre_commentaires', ascending=False)
        
        top10_comments = commenters_df_single.set_index('commentateur')['nombre_commentaires'].head(10).to_dict()
        top10_karma = commenters_df_single.set_index('commentateur')['notoriete_moyenne_karma'].head(10).to_dict()
        
        metrics_data['top10_comments_by_commentator'] = json.dumps(top10_comments)
        metrics_data['top10_avg_karma_by_commentator'] = json.dumps(top10_karma)
    else:
        metrics_data['top10_comments_by_commentator'] = json.dumps({})
        metrics_data['top10_avg_karma_by_commentator'] = json.dumps({})

    metrics_df = pd.DataFrame([metrics_data])
    
    try:
        metrics_df.to_sql(TABLE_DOCUMENT_METRICS, engine, if_exists='append', index=False)
        print(f"Métriques spécifiques au document insérées dans la table '{TABLE_DOCUMENT_METRICS}'.")
    except Exception as e:
        print(f"Erreur lors de l'insertion des métriques dans la DB pour '{original_filename_simulated}': {e}")

    # --- Affinage du Dictionnaire (Suggestions dans un fichier local) ---
    dict_refinements = suggest_dictionary_refinements(df_processed_single, BRANDS_DICT, VEHICLE_TYPES, PROBLEMS)
    with open(os.path.join(current_output_dir, "suggestions_dictionnaire.json"), 'w', encoding='utf-8') as f:
        json.dump(dict_refinements, f, indent=4, ensure_ascii=False)
    print(f"Suggestions d'affinage du dictionnaire enregistrées LOCALEMENT dans : {os.path.join(current_output_dir, 'suggestions_dictionnaire.json')}")

    # --- Enregistrer les données traitées dans la table processed_posts ---
    processed_cols = [
        'id', 'vehicle_type', 'brand', 'model', 'year', 'problem',
        'needs_comment_processing', 'tout_les_commentaires', 'commentateurs_details_json',
        'has_image', 'image_description', # Nouvelle colonne ici
        'has_significant_content', 'is_ai_generated_consensus',
        'ai_diagnosis', 'ai_solution_steps_json', 'ai_parts_needed_json',
        'consensus_des_commentaires', 'solution_steps_json', 'parts_needed_json',
        'web_diagnosis', 'web_solution_steps_json', 'web_parts_needed_json', 'web_relevance_score'
    ]
    df_processed_for_db = df_processed_single[processed_cols].copy()
    df_processed_for_db['raw_post_id'] = df_processed_for_db['id']
    
    try:
        with engine.connect() as connection:
            for index, row in df_processed_for_db.iterrows():
                row_dict = row.to_dict()
                columns = ', '.join(row_dict.keys())
                placeholders = ', '.join([f":{col}" for col in row_dict.keys()])
                update_set = ', '.join([f"{col} = :{col}" for col in row_dict.keys() if col != 'id'])

                query = text(f"""
                    INSERT INTO {TABLE_PROCESSED_POSTS} ({columns}) VALUES ({placeholders})
                    ON CONFLICT (id) DO UPDATE SET {update_set};
                """)
                connection.execute(query, row_dict)
            connection.commit()
        print(f"Données traitées du post '{df_input.iloc[0]['id']}' insérées/mises à jour dans la table '{TABLE_PROCESSED_POSTS}'.")
    except Exception as e:
        print(f"Erreur lors de l'insertion/mise à jour des données traitées dans la DB pour '{df_input.iloc[0]['id']}': {e}")
        pass

    # --- Génération Q&R et Prompt Système (pour chaque document dans la DB) ---
    qa_examples_list = []
    qa_df_candidates = df_processed_single[
        (df_processed_single['has_image'] == False) &
        df_processed_single['problem'].notna() &
        (df_processed_single['consensus_des_commentaires'] != '') &
        (
            (df_processed_single['tout_les_commentaires'] != '') & (~df_processed_single['tout_les_commentaires'].str.contains('ERREUR_PRAW')) & (~df_processed_single['tout_les_commentaires'].str.contains('PENDING_COMMENTS_DELAY')) |
            df_processed_single['is_ai_generated_consensus'] |
            (df_processed_single['web_diagnosis'].notna() & (df_processed_single['web_relevance_score'] > 0))
        )
    ].sample(min(1, len(df_processed_single)), random_state=42)

    if not qa_df_candidates.empty:
        system_prompt_for_qa = "Vous êtes un spécialiste de la mécanique diesel, capable de diagnostiquer des problèmes, de proposer des étapes de réparation séquentielles, d'identifier les pièces nécessaires, et de donner des rappels importants. Répondez de manière claire, concise et professionnelle."
        
        for idx, row in qa_df_candidates.iterrows():
            question_template = f"Mon {row['year'] if pd.notna(row['year']) else ''} {row['brand'] if pd.notna(row['brand']) else ''} {row['model'] if pd.notna(row['model']) else ''} a un problème de {row['problem']}. Quelle est la cause probable et comment le réparer ?"
            
            solution_steps, parts_needed, _ = get_best_consensus_and_solutions(row)
            
            answer_parts = [
                f"Pour votre véhicule, le problème de '{row['problem']}' est un souci courant. Le consensus indique que {row['consensus_des_commentaires']}."
            ]
            if solution_steps:
                answer_parts.append("\nÉtapes de solution suggérées :")
                answer_parts.extend(solution_steps)
            if parts_needed:
                answer_parts.append(f"\nPièces potentiellement nécessaires : {', '.join(parts_needed)}.")
            
            qa_examples_list.append({
                "post_id": row['id'],
                "system_prompt": system_prompt_for_qa,
                "question": question_template.strip(),
                "answer": "\n".join(answer_parts).strip()
            })
        
        df_qa = pd.DataFrame(qa_examples_list)
        try:
            df_qa.to_sql(TABLE_QA_TRAINING_DATA, engine, if_exists='append', index=False)
            print(f"Paires Q&R pour l'entraînement insérées dans la table '{TABLE_QA_TRAINING_DATA}'.")
        except Exception as e:
            print(f"Erreur lors de l'insertion des Q&R dans la DB pour '{df_input.iloc[0]['id']}': {e}")
    else:
        print("Pas assez de données pour générer des Q&R significatives pour ce document.")


    return df_processed_single, metrics_df


# --- Flask Web Service Endpoint ---
@app.route('/process_reddit_post', methods=['POST'])
def process_reddit_post_webhook():
    """
    Endpoint pour recevoir les webhooks d'IFTTT avec les données d'un post Reddit.
    """
    if not request.is_json:
        return jsonify({"status": "error", "message": "Content-Type must be application/json"}), 400

    post_data = request.get_json()
    if not post_data:
        return jsonify({"status": "error", "message": "No JSON data received"}), 400

    print(f"Webhook reçu pour le post ID: {post_data.get('PostId', 'N/A')}")
    
    try:
        create_db_tables() 
        processed_df, metrics_df = process_single_post_data(post_data)
        
        if processed_df is not None:
            return jsonify({"status": "success", "message": f"Post {post_data.get('PostId', 'N/A')} processed and saved to DB."}), 200
        else:
            return jsonify({"status": "error", "message": f"Failed to process post {post_data.get('PostId', 'N/A')}."}), 500

    except Exception as e:
        print(f"Erreur inattendue lors du traitement du webhook: {e}")
        return jsonify({"status": "error", "message": f"Internal server error: {e}"}), 500

# --- Route de Bienvenue (pour vérifier que le service est actif) ---
@app.route('/')
def hello():
    return "Workflow d'analyse Diesel actif sur Render. En attente de webhooks IFTTT sur /process_reddit_post."

# --- EXÉCUTION POUR LE TEST LOCAL ---
if __name__ == '__main__':
    print("Démarrage de l'application Flask pour test local...")
    # Crée un fichier dummy 'diesel_data.csv' si non trouvé, pour simuler un post.
    original_data_path = 'diesel_data.csv'
    if not os.path.exists(original_data_path):
        print(f"Le fichier source original '{original_data_path}' est introuvable. Création d'un fichier dummy.")
        dummy_data = {
            'date_post': [(datetime.now() - pd.Timedelta(days=5)).strftime('%B %d, %Y at %I:%M%p')], # Date récente pour tester IA
            'author': ['test_user_img'],
            'title': ['Mon F-150 fait de la fumée bleue au démarrage'],
            'Selftext': ['J\'ai un F-150 de 2015, et depuis quelques jours, je vois de la fumée bleue sortir du pot au démarrage. J\'ai pris une photo du moteur.'],
            'url_image': ['https://i.imgur.com/example_blue_smoke.jpg'], # Simuler une URL d'image
            'subreddit': ['/r/Diesel'],
            'id': ['test_post_id_img_1'],
            'url_post': ['https://www.reddit.com/r/Diesel/comments/test_post_id_img_1/blue_smoke_issue/'],
        }
        # Les colonnes suivantes sont ajoutées pour la compatibilité avec le reste du script
        dummy_data['Réponse de Chatgpt'] = ['']
        dummy_data['MOTS CLE'] = ['']
        dummy_data['NOMBRE DE COMMENTAIRES'] = [0]
        dummy_data['cONSENSUS DES COMMENTAIRES'] = ['']
        dummy_data['TOUT LES COMMENTAIRES'] = ['']
        dummy_data['Unnamed: 13'] = ['']
        pd.DataFrame(dummy_data).to_csv(original_data_path, index=False)
        print("Fichier dummy 'diesel_data.csv' créé pour la démonstration.")

    # Simuler des données qu'IFTTT enverrait
    # Pour ce test, on simule un post avec une image et un problème, datant de moins de 14 jours,
    # pour tester l'analyse d'image et le fallback IA (PRAW sera skippé).
    post_data_example = {
        "CreatedAt": (datetime.now() - pd.Timedelta(days=5)).strftime('%B %d, %Y at %I:%M%p'),
        "AuthorName": "ifttt_user_img",
        "Title": "New post: Mercedes Sprinter coolant leak!",
        "Content": "My 2017 Mercedes Sprinter has a noticeable coolant leak near the water pump. I've attached a picture.",
        "ImageUrl": "https://i.imgur.com/example_coolant_leak.jpg", # URL d'image factice
        "Subreddit": "/r/SprinterVans",
        "PostId": "new_sprinter_id_999",
        "PostUrl": "https://www.reddit.com/r/SprinterVans/comments/new_sprinter_id_999/coolant_leak/"
    }

    print("\n--- TEST LOCAL : Appel de process_single_post_data avec un exemple IFTTT (incluant image) ---")
    create_db_tables() # S'assurer que les tables sont prêtes pour le test local
    processed_df_test, metrics_df_test = process_single_post_data(post_data_example)
    if processed_df_test is not None:
        print("\nRésultats du test local (DataFrame traité):")
        print(processed_df_test[['id', 'problem', 'has_image', 'image_description', 'tout_les_commentaires', 'is_ai_generated_consensus', 'web_diagnosis', 'consensus_des_commentaires']].to_string())
        print("\nMétriques du test local (DataFrame métriques):")
        print(metrics_df_test.to_string())
    else:
        print("Échec du traitement du post de test local.")

    print("\nPour exécuter l'application Flask localement, décommentez 'app.run(...)' et assurez-vous d'avoir les variables d'environnement définies ou les valeurs par défaut dans le code.")
    # app.run(debug=True, host='0.0.0.0', port=os.getenv("PORT", 5000))
