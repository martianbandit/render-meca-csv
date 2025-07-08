import React, { useState, useRef, useEffect, useCallback, createContext, useContext } from 'react';
import {
  Send, Settings, History, Sun, Moon, Code, Image as ImageIcon, Brain, Search, Zap, X, ChevronDown, MessageSquare, Cpu, Globe, Network, Eye, Mic, FileText, BarChart3, Sparkles, PlusCircle, Trash2, Loader2, Paperclip, User, LogOut,
  Cloud, Mail, Calendar, MapPin, Wrench, Users, Plus, LayoutGrid
} from 'lucide-react';

// Firebase Imports
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, collection, onSnapshot, setDoc, addDoc, deleteDoc, query, orderBy, serverTimestamp, where, getDocs, getDoc } from 'firebase/firestore';

// Global variables provided by the Canvas environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;


// --- Service API MCP ---
const mcpApiService = {
  async generateResponse({ message, model, context, openaiConfig, anthropicConfig, customModelConfig }) {
    console.log("Envoi à l'API MCP (simulé) :", { message, model, context });

    let responseText = '';
    let powerUsed = null;

    const commandPowerMap = { '/code': 'codeGen', '/search': 'superSearch', '/image': 'imageGen' };
    const command = Object.keys(commandPowerMap).find(cmd => message.startsWith(cmd));

    if (command) {
      powerUsed = commandPowerMap[command];
      switch (powerUsed) {
        case 'codeGen':
          responseText = "Voici un exemple de code, généré via le pouvoir 'Code Gen' :\n```javascript\nconst mcp = require('model-context-protocol');\n\nasync function main() {\n  console.log('Connecté à MCP!');\n}\n\nmain();\n```";
          break;
        case 'superSearch':
          responseText = "Le pouvoir 'Super Search' a été activé. D'après ma recherche web (simulée), le protocole MCP a été annoncé par Anthropic.";
          break;
        case 'imageGen':
          responseText = "Voici une image générée avec le pouvoir 'Image Gen' (ceci est une simulation) :\n\n[Image d'un logo de protocole universel dans un style futuriste]";
          break;
        default:
          responseText = `Le pouvoir pour la commande '${command}' est activé.`;
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    } else {
      try {
        let apiUrl = '';
        let headers = { 'Content-Type': 'application/json' };
        let payload = {};
        let responseParser = null; // Function to parse the specific API response

        // Prepare messages array for API calls
        const apiMessages = [];
        if (context.systemPrompt) {
          apiMessages.push({ role: "system", content: context.systemPrompt });
        }
        apiMessages.push({ role: "user", content: message });


        if (model.startsWith('gpt-')) { // OpenAI Models
          if (!openaiConfig || !openaiConfig.apiKey) {
            throw new Error("Erreur : Clé API OpenAI non configurée. Veuillez l'ajouter dans les paramètres.");
          }
          apiUrl = `${openaiConfig.baseUrl || 'https://api.openai.com'}/v1/chat/completions`;
          headers['Authorization'] = `Bearer ${openaiConfig.apiKey}`;
          payload = { model: model, messages: apiMessages }; // OpenAI handles system role in messages array
          responseParser = (result) => result.choices?.[0]?.message?.content;
        } else if (model.startsWith('claude-')) { // Anthropic Models
          if (!anthropicConfig || !anthropicConfig.apiKey) {
            throw new Error("Erreur : Clé API Anthropic non configurée. Veuillez l'ajouter dans les paramètres.");
          }
          apiUrl = `${anthropicConfig.baseUrl || 'https://api.anthropic.com/v1'}/messages`;
          headers['x-api-key'] = anthropicConfig.apiKey;
          headers['anthropic-version'] = '2023-06-01'; // Required for Anthropic
          payload = {
              model: model,
              max_tokens: 1024,
              messages: apiMessages.map(msg => ({ // Anthropic expects 'role', 'content', but 'system' isn't a direct message role
                  role: msg.role === 'system' ? 'user' : msg.role,
                  content: msg.content
              }))
          };
          responseParser = (result) => result.content?.[0]?.text;
        } else if (model.startsWith('custom-api-')) { // Custom API Models (like Grok)
            if (!customModelConfig || !customModelConfig.baseUrl) {
                throw new Error("Erreur : URL de base du modèle personnalisé non configurée. Veuillez l'ajouter dans les paramètres.");
            }
            apiUrl = `${customModelConfig.baseUrl}/v1/chat/completions`; // Assume OpenAI-compatible endpoint
            payload = { model: customModelConfig.name, messages: apiMessages }; // Pass messages as is
            responseParser = (result) => result.choices?.[0]?.message?.content;
        } else { // Gemini Models (default via Canvas environment)
          apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=`; // API key provided by Canvas
          payload = { contents: apiMessages.map(msg => ({
              role: msg.role === 'system' ? 'user' : msg.role, // Gemini doesn't have system message role in 'contents'
              parts: [{ text: msg.content }]
          }))};
          responseParser = (result) => result.candidates?.[0]?.content?.parts?.[0]?.text;
        }

        console.log(`Appel à l'API ${model} avec le payload :`, payload);

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Erreur API: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const result = await response.json();
        responseText = responseParser(result);

        if (!responseText) {
            console.error("Réponse inattendue de l'API:", result);
            responseText = `Désolé, je n'ai pas pu générer une réponse. Réponse de l'API inattendue.`;
        }

      } catch (error) {
        console.error("Erreur lors de l'appel à l'API :", error);
        responseText = `Désolé, une erreur est survenue lors de la communication avec le modèle : ${error.message}.`;
      }
    }

    const activeConnectorNames = context.activeConnectors.map(c => c.name).join(', ');
    const systemPromptText = context.systemPrompt && !command ? `\n\n*Prompt Système appliqué: "${context.systemPrompt}"*` : '';
    responseText += `\n\n*Contexte utilisé (Connecteurs): ${activeConnectorNames || 'Aucun'}*${systemPromptText}`;

    return { text: responseText, powerUsed };
  }
};

// --- Hook Personnalisé pour la Logique du Chat ---
const useMcpChat = (db, auth, currentUserId, isAuthReady, activeAgent, allTools, anthropicConfig, customModels, authStatus) => {
  const [conversations, setConversations] = useState({});
  const [currentConversationId, setCurrentConversationId] = useState('');
  const [activeConnectors, setActiveConnectors] = useState(['filesystem', 'web']);
  const [requestCounts, setRequestCounts] = useState({ reasoning: 15, superSearch: 8, codeGen: 12, imageGen: 5, orchestration: 3 });
  const [isLoading, setIsLoading] = useState(false);

  const createNewConversation = useCallback(async (type = 'chat', title = 'Nouvelle Discussion') => {
    if (!db || !currentUserId || authStatus !== 'authenticated') {
        console.warn("Impossible de créer une conversation: DB, UserId ou Auth non disponibles/authentifiés.");
        return null;
    }
    try {
      const newConversationRef = doc(collection(db, `artifacts/${appId}/users/${currentUserId}/conversations`));
      const newConvData = {
          title: title,
          messages: [],
          type: type,
          systemPrompt: null,
          createdAt: serverTimestamp(),
          lastUpdated: serverTimestamp()
      };
      await setDoc(newConversationRef, newConvData);
      console.log(`Conversation créée avec ID: ${newConversationRef.id}`);
      return newConversationRef.id;
    } catch (error) {
      console.error("Erreur lors de la création de la conversation:", error);
      return null;
    }
  }, [db, currentUserId, authStatus]);


  useEffect(() => {
    if (!db || !currentUserId || authStatus !== 'authenticated') {
        console.log("Waiting for DB, userId, or successful authentication for conversations. Current status:", authStatus);
        return;
    }

    const convCollectionRef = collection(db, `artifacts/${appId}/users/${currentUserId}/conversations`);
    const q = query(convCollectionRef, orderBy('lastUpdated', 'desc'));

    console.log(`Setting up conversation listener for user: ${currentUserId}`);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loadedConversations = {};
      snapshot.forEach(doc => {
        loadedConversations[doc.id] = { id: doc.id, ...doc.data() };
      });
      setConversations(loadedConversations);
      console.log("Conversations loaded:", Object.keys(loadedConversations).length);
    }, (error) => {
      console.error("Erreur lors de l'écoute des conversations Firestore:", error);
    });

    return () => {
        console.log("Unsubscribing from conversations.");
        unsubscribe();
    }
  }, [db, currentUserId, authStatus]);


  useEffect(() => {
    if (authStatus === 'authenticated') { // Only try to set current conversation if authenticated
      const allConversationIds = Object.keys(conversations);
      if (allConversationIds.length > 0) {
        if (!currentConversationId || !conversations[currentConversationId]) {
          setCurrentConversationId(allConversationIds[0]);
          console.log("Set current conversation to first available:", allConversationIds[0]);
        }
      } else {
        if (Object.keys(conversations).length === 0) {
            console.log("No conversations found, creating a new one.");
            createNewConversation('chat');
        }
      }
    }
  }, [authStatus, conversations, currentConversationId, createNewConversation]);


  const deleteConversation = useCallback(async (idToDelete) => {
    if (!db || !currentUserId || authStatus !== 'authenticated') return;
    try {
      await deleteDoc(doc(db, `artifacts/${appId}/users/${currentUserId}/conversations`, idToDelete));
      console.log(`Conversation ${idToDelete} supprimée.`);
    } catch (error) {
      console.error("Erreur lors de la suppression de la conversation:", error);
    }
  }, [db, currentUserId, authStatus]);

  const updateChatHistory = useCallback(async (newMessage, conversationId) => {
    if (!db || !currentUserId || !conversationId || authStatus !== 'authenticated') return;
    try {
      const convRef = doc(db, `artifacts/${appId}/users/${currentUserId}/conversations`, conversationId);
      const currentConv = conversations[conversationId];
      if (!currentConv) {
          console.error("Conversation non trouvée pour mise à jour:", conversationId);
          return;
      }

      const newMessages = [...currentConv.messages, newMessage];
      const newTitle = currentConv.messages.length === 0 && newMessage.sender === 'user'
        ? newMessage.text.substring(0, 40) + (newMessage.text.length > 40 ? '...' : '')
        : currentConv.title;

      await setDoc(convRef, {
        messages: newMessages,
        title: newTitle,
        lastUpdated: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error("Erreur lors de la mise à jour de l'historique du chat:", error);
    }
  }, [db, currentUserId, conversations, authStatus]);

  const setSystemPromptForCurrentConversation = useCallback(async (prompt) => {
    if (!db || !currentUserId || !currentConversationId || authStatus !== 'authenticated') return;
    try {
      const convRef = doc(db, `artifacts/${appId}/users/${currentUserId}/conversations`, currentConversationId);
      await setDoc(convRef, { systemPrompt: prompt, lastUpdated: serverTimestamp() }, { merge: true });
    } catch (error) {
      console.error("Erreur lors de la mise à jour du prompt système:", error);
    }
  }, [db, currentUserId, currentConversationId, authStatus]);

  const connectors = [
    { id: 'filesystem', name: 'Système de fichiers', icon: FileText },
    { id: 'web', name: 'Recherche Web', icon: Globe },
    { id: 'database', name: 'Base de données', icon: BarChart3 },
    { id: 'vision', name: 'API Vision', icon: Eye },
    { id: 'audio', name: 'Traitement Audio', icon: Mic }
  ];

  const powers = [
    { id: 'reasoning', name: 'Raisonnement', count: requestCounts.reasoning, icon: Brain, color: 'text-sky-400' },
    { id: 'superSearch', name: 'Super Recherche', count: requestCounts.superSearch, icon: Search, color: 'text-teal-400', command: '/search' },
    { id: 'codeGen', name: 'Génération de Code', count: requestCounts.codeGen, icon: Code, color: 'text-emerald-400', command: '/code' },
    { id: 'imageGen', name: 'Génération d\'Images', count: requestCounts.imageGen, icon: ImageIcon, color: 'text-rose-400', command: '/image' },
    { id: 'orchestration', name: 'Orchestration', count: requestCounts.orchestration, icon: Network, color: 'text-amber-400' }
  ];

  // Détermine le prompt système et les outils pour le modèle en fonction de l'agent actif
  const currentSystemPrompt = activeAgent?.professionPrompt || conversations[currentConversationId]?.systemPrompt;
  const currentTools = activeAgent?.toolIds ? allTools.filter(tool => activeAgent.toolIds.includes(tool.id) && tool.status === 'active') : [];


  const sendMessage = useCallback(async (message, model, openaiConfig, anthropicConfig, customModels) => {
    if (!message.trim() || !currentConversationId || authStatus !== 'authenticated') return;

    const userMessage = { id: Date.now(), text: message, sender: 'user', timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    await updateChatHistory(userMessage, currentConversationId);
    setIsLoading(true);

    try {
      const commandPower = powers.find(p => p.command && message.startsWith(p.command));
      if (commandPower && requestCounts[commandPower.id] <= 0) {
        throw new Error(`Crédits épuisés pour le pouvoir '${commandPower.name}'.`);
      }

      let selectedCustomModelConfig = null;
      if (model.startsWith('custom-api-')) {
          selectedCustomModelConfig = customModels.find(m => m.id === model);
          if (!selectedCustomModelConfig) {
              throw new Error(`Modèle personnalisé '${model}' introuvable.`);
          }
      }

      const response = await mcpApiService.generateResponse({
        message,
        model,
        context: {
          activeConnectors: connectors.filter(c => activeConnectors.includes(c.id)),
          systemPrompt: currentSystemPrompt,
          tools: currentTools
        },
        openaiConfig,
        anthropicConfig,
        customModelConfig: selectedCustomModelConfig
      });

      if (response.powerUsed) {
        setRequestCounts(prev => ({ ...prev, [response.powerUsed]: prev[response.powerUsed] - 1 }));
      }

      const aiResponse = { id: Date.now() + 1, text: response.text, sender: 'ai', timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), model };
      await updateChatHistory(aiResponse, currentConversationId);
    } catch (error) {
      console.error("Erreur lors de la génération de la réponse :", error);
      const errorMessage = { id: Date.now() + 1, text: `Une erreur est survenue : ${error.message}`, sender: 'ai', isError: true, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
      await updateChatHistory(errorMessage, currentConversationId);
    } finally {
      setIsLoading(false);
    }
  }, [currentConversationId, updateChatHistory, conversations, activeConnectors, powers, requestCounts, currentSystemPrompt, currentTools, anthropicConfig, customModels, authStatus]);


  return {
    conversations,
    currentConversationId,
    setCurrentConversationId,
    currentChatHistory: conversations[currentConversationId]?.messages || [],
    createNewConversation,
    deleteConversation,
    sendMessage,
    isLoading,
    activeConnectors,
    setActiveConnectors,
    connectors,
    powers,
    setSystemPromptForCurrentConversation,
    currentSystemPrompt,
    currentTools
  };
};

// --- Composant Popup du Gestionnaire de Prompts ---
const PromptManagerPopup = ({ isOpen, onClose, onSelectPrompt, onSelectSystemPrompt, customPrompts, onAddPrompt, onDeletePrompt, theme }) => {
    if (!isOpen) return null;

    const [newPrompt, setNewPrompt] = useState('');

    const defaultConversationPrompts = [
        "Explique ce concept en termes simples :",
        "Rédige un e-mail professionnel pour :",
        "Résume le texte suivant :",
        "Génère 5 titres accrocheurs pour :"
    ];

    const systemPrompts = [
      "Agir comme un expert en codage Python.",
      "Agir comme un spécialiste du marketing digital.",
      "Agir comme un assistant créatif et inspirant.",
      "Répondre toujours de manière concise et directe.",
      "Focus sur les données factuelles uniquement."
    ];

    const handleAddConversationPrompt = () => {
        if (newPrompt.trim()) {
            onAddPrompt(newPrompt.trim());
            setNewPrompt('');
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className={`${theme.card} border ${theme.border} rounded-2xl w-full max-w-2xl max-h-[70vh] flex flex-col`}>
                <div className={`p-5 border-b ${theme.border} flex items-center justify-between`}>
                    <h3 className="text-lg font-semibold">Gestionnaire de Prompts</h3>
                    <button onClick={onClose}><X className="w-6 h-6" /></button>
                </div>
                <div className="p-5 space-y-6 overflow-y-auto">
                    {/* Section Amorces de Discussion */}
                    <div>
                        <h4 className={`font-semibold mb-3 ${theme.subtleText}`}>Amorces de Discussion (pré-remplissent l'input)</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {defaultConversationPrompts.map((p, i) => (
                                <button key={`default-${i}`} onClick={() => onSelectPrompt(p)} className={`w-full text-left text-sm p-3 rounded-md ${theme.hover}`}>
                                    {p}
                                </button>
                            ))}
                        </div>
                        {/* Prompts Personnalisés */}
                        <div className="space-y-2 mt-4 mb-4">
                            {customPrompts.length > 0 ? customPrompts.map((p, i) => (
                                <div key={`custom-${i}`} className={`group flex items-center justify-between p-3 rounded-md ${theme.hover}`}>
                                    <button onClick={() => onSelectPrompt(p)} className="flex-1 text-left text-sm">{p}</button>
                                    <button onClick={() => onDeletePrompt(p)} className="opacity-0 group-hover:opacity-100 text-red-500 transition-opacity"><Trash2 className="w-4 h-4"/></button>
                                </div>
                            )) : <p className={`text-sm ${theme.subtleText}`}>Aucune amorce personnalisée.</p>}
                        </div>
                        {/* Entrée pour ajouter de nouveaux prompts personnalisés */}
                        <div className="flex items-center gap-2 mt-4">
                            <input
                                type="text"
                                value={newPrompt}
                                onChange={(e) => setNewPrompt(e.target.value)}
                                placeholder="Créer une nouvelle amorce de discussion..."
                                className={`flex-1 bg-transparent border ${theme.border} rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500`}
                            />
                            <button onClick={handleAddConversationPrompt} className={`px-4 py-1.5 text-sm font-semibold rounded-md ${theme.accent} ${theme.accentText}`}>Ajouter</button>
                        </div>
                    </div>

                    {/* Section Prompts Systèmes */}
                    <div className="mt-8">
                        <h4 className={`font-semibold mb-3 ${theme.subtleText}`}>Prompts Systèmes (affectent le comportement du modèle)</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {systemPrompts.map((p, i) => (
                                <button key={`system-${i}`} onClick={() => { onSelectSystemPrompt(p); onClose(); }} className={`w-full text-left text-sm p-3 rounded-md ${theme.hover}`}>
                                    {p}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Composant Popup pour le Gestionnaire de Contextes (Pastilles) ---
const ContextPillsManagerPopup = ({ isOpen, onClose, onSelectContext, customContextPills, onAddContextPill, onDeleteContextPill, theme, activeSystemPrompt }) => {
    if (!isOpen) return null;

    const [newContextName, setNewContextName] = useState('');
    const [newContextPrompt, setNewContextPrompt] = useState('');

    const defaultContextPills = [
        { name: "Expert en Codage Python", prompt: "Agir comme un expert en codage Python. Fournir des extraits de code clairs et optimisés." },
        { name: "Spécialiste Marketing Digital", prompt: "Agir comme un spécialiste du marketing digital. Offrir des stratégies et des analyses pour les campagnes en ligne." },
        { name: "Analyste Financier", prompt: "Agir comme un analyste financier. Fournir des informations sur les marchés, les investissements et les tendances économiques." },
        { name: "Coach de Vie", prompt: "Agir comme un coach de vie. Offrir des conseils motivants et des stratégies pour le développement personnel." },
        { name: "Historien", prompt: "Agir comme un historien expert. Fournir des faits précis et des analyses contextuelles sur les événements passés." },
        { name: "Écrivain Créatif", prompt: "Agir comme un écrivain créatif. Générer des idées d'histoires, des dialogues et des descriptions immersives." },
        { name: "Conseiller en Santé et Bien-être", prompt: "Agir comme un conseiller en santé et bien-être. Offrir des informations générales sur la nutrition, l'exercice et le bien-être mental (ne pas donner de conseils médicaux)." },
        { name: "Chef Cuisinier", prompt: "Agir comme un chef cuisinier. Proposer des recettes, des techniques de cuisine et des astuces culinaires." },
        { name: "Designer UX/UI", prompt: "Agir comme un designer UX/UI. Fournir des principes de conception, des critiques d'interface et des idées d'amélioration de l'expérience utilisateur." },
        { name: "Expert en Cybersécurité", prompt: "Agir comme un expert en cybersécurité. Expliquer les menaces, les vulnérabilités et les meilleures pratiques de sécurité." },
        { name: "Spécialiste du Service Client", prompt: "Agir comme un spécialiste du service client. Fournir des réponses claires, utiles et amicales pour résoudre les problèmes." },
        { name: "Formateur en Langues", prompt: "Agir comme un formateur en langues. Aider à l'apprentissage de nouvelles langues en fournissant des traductions, des explications grammaticales et des exercices." },
        { name: "Conseiller en Voyages", prompt: "Agir comme un conseiller en voyages. Proposer des destinations, des itinéraires et des astuces pour planifier des voyages mémorables." },
        { name: "Professeur de Sciences", prompt: "Agir comme un professeur de sciences. Expliquer des concepts scientifiques complexes de manière simple et engageante." },
        { name: "Développeur Front-end", prompt: "Agir comme un développeur front-end. Fournir du code HTML, CSS, JavaScript et des conseils sur les frameworks modernes." }
    ];

    const handleAddContextPill = () => {
        if (newContextName.trim() && newContextPrompt.trim()) {
            onAddContextPill({ name: newContextName.trim(), prompt: newContextPrompt.trim() });
            setNewContextName('');
            setNewContextPrompt('');
        } else {
            alert('Le nom et le prompt du contexte sont requis.');
        }
    };

    const allContextPills = [...defaultContextPills, ...customContextPills];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className={`${theme.card} border ${theme.border} rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col`}>
                <div className={`p-5 border-b ${theme.border} flex items-center justify-between`}>
                    <h3 className="text-lg font-semibold">Gestionnaire de Contextes (Pastilles)</h3>
                    <button onClick={onClose}><X className="w-6 h-6" /></button>
                </div>
                <div className="p-5 space-y-6 overflow-y-auto">
                    {/* Section Ajouter un nouveau contexte */}
                    <div>
                        <h4 className={`font-semibold mb-3 ${theme.subtleText}`}>Ajouter un nouveau contexte</h4>
                        <div className="space-y-3">
                            <div>
                                <label htmlFor="contextName" className={`block text-sm font-medium mb-1 ${theme.text}`}>Nom du Contexte</label>
                                <input
                                    type="text"
                                    id="contextName"
                                    value={newContextName}
                                    onChange={(e) => setNewContextName(e.target.value)}
                                    placeholder="Ex: Expert en Cybersécurité"
                                    className={`w-full bg-transparent border ${theme.border} rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500`}
                                />
                            </div>
                            <div>
                                <label htmlFor="contextPrompt" className={`block text-sm font-medium mb-1 ${theme.text}`}>Prompt Système associé</label>
                                <textarea
                                    id="contextPrompt"
                                    value={newContextPrompt}
                                    onChange={(e) => setNewContextPrompt(e.target.value)}
                                    placeholder="Ex: Agir comme un expert en cybersécurité. Expliquer les menaces et les meilleures pratiques."
                                    rows="3"
                                    className={`w-full bg-transparent border ${theme.border} rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500`}
                                ></textarea>
                            </div>
                            <button onClick={handleAddContextPill} className={`px-4 py-2 text-sm font-semibold rounded-md ${theme.accent} ${theme.accentText} hover:bg-blue-700 transition-colors`}>
                                Ajouter le Contexte
                            </button>
                        </div>
                    </div>

                    {/* Section Liste des contextes */}
                    <div className="mt-8">
                        <h4 className={`font-semibold mb-3 ${theme.subtleText}`}>Contextes configurés ({allContextPills.length})</h4>
                        {allContextPills.length > 0 ? (
                            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {allContextPills.map((context, index) => (
                                    <li key={context.id || `default-${index}`} className={`group flex items-center justify-between p-3 rounded-md border ${theme.border} ${activeSystemPrompt === context.prompt ? `${theme.accent} ${theme.accentText} border-blue-600` : theme.hover}`}>
                                        <button onClick={() => onSelectContext(context.prompt)} className="flex-1 text-left text-sm font-medium">
                                            {context.name}
                                        </button>
                                        {context.id && ( // Only show delete button for custom (Firestore-backed) contexts
                                            <button onClick={() => onDeleteContextPill(context.id)} className="opacity-0 group-hover:opacity-100 text-red-500 transition-opacity ml-2">
                                                <Trash2 className="w-4 h-4"/>
                                            </button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className={`text-sm ${theme.subtleText}`}>Aucun contexte n'a été configuré.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};


// --- Composant Popup pour la Gestion des Outils ---
const ToolsManagerPopup = ({ isOpen, onClose, theme, tools, onAddTool, onUpdateToolStatus, onDeleteTool }) => {
    if (!isOpen) return null;

    const [newToolName, setNewToolName] = useState('');
    const [newToolDescription, setNewToolDescription] = useState('');
    const [newToolOpenApiSpec, setNewToolOpenApiSpec] = useState('');
    const [openApiSpecError, setOpenApiSpecError] = useState('');

    const handleAddTool = () => {
        if (!newToolName.trim() || !newToolOpenApiSpec.trim()) {
            alert('Le nom de l\'outil et la spécification OpenAPI sont requis.');
            return;
        }
        try {
            JSON.parse(newToolOpenApiSpec); // Valide le JSON
            onAddTool({
                name: newToolName.trim(),
                description: newToolDescription.trim(),
                openapiSpec: newToolOpenApiSpec.trim(),
                status: 'inactive' // Par défaut inactif
            });
            setNewToolName('');
            setNewToolDescription('');
            setNewToolOpenApiSpec('');
            setOpenApiSpecError('');
        } catch (e) {
            setOpenApiSpecError('Spécification OpenAPI invalide (doit être un JSON valide).');
            console.error("Erreur de parsing OpenAPI Spec:", e);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className={`${theme.card} border ${theme.border} rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col`}>
                <div className={`p-5 border-b ${theme.border} flex items-center justify-between`}>
                    <h3 className="text-lg font-semibold">Gestionnaire d'Outils</h3>
                    <button onClick={onClose}><X className="w-6 h-6" /></button>
                </div>
                <div className="p-5 space-y-6 overflow-y-auto">
                    {/* Section Ajouter un nouvel outil */}
                    <div>
                        <h4 className={`font-semibold mb-3 ${theme.subtleText}`}>Ajouter un nouvel outil</h4>
                        <div className="space-y-3">
                            <div>
                                <label htmlFor="toolName" className={`block text-sm font-medium mb-1 ${theme.text}`}>Nom de l'outil</label>
                                <input
                                    type="text"
                                    id="toolName"
                                    value={newToolName}
                                    onChange={(e) => setNewToolName(e.target.value)}
                                    placeholder="Ex: API Météo"
                                    className={`w-full bg-transparent border ${theme.border} rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500`}
                                />
                            </div>
                            <div>
                                <label htmlFor="toolDescription" className={`block text-sm font-medium mb-1 ${theme.text}`}>Description (optionnel)</label>
                                <input
                                    type="text"
                                    id="toolDescription"
                                    value={newToolDescription}
                                    onChange={(e) => setNewToolDescription(e.target.value)}
                                    placeholder="Une brève description de l'outil"
                                    className={`w-full bg-transparent border ${theme.border} rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500`}
                                />
                            </div>
                            <div>
                                <label htmlFor="openApiSpec" className={`block text-sm font-medium mb-1 ${theme.text}`}>Spécification OpenAPI (JSON)</label>
                                <textarea
                                    id="openApiSpec"
                                    value={newToolOpenApiSpec}
                                    onChange={(e) => setNewToolOpenApiSpec(e.target.value)}
                                    placeholder={`{\n  "openapi": "3.0.0",\n  "info": {\n    "title": "Exemple API Météo",\n    "version": "1.0.0"\n  },\n  "paths": {\n    "/weather": {\n      "get": {\n        "summary": "Obtenir la météo actuelle",\n        "parameters": [\n          {\n            "name": "location",\n            "in": "query",\n            "required": true,\n            "schema": {\n              "type": "string"\n            }\n          }\
        ],\n        "responses": {\n          "200": {\n            "description": "Météo actuelle"\n          }\n        }\n      }\n    }\n  }\n}`}
                                    rows="8"
                                    className={`w-full bg-transparent border ${theme.border} rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${openApiSpecError ? 'border-red-500' : ''}`}
                                ></textarea>
                                {openApiSpecError && <p className="text-red-500 text-xs mt-1">{openApiSpecError}</p>}
                            </div>
                            <button onClick={handleAddTool} className={`px-4 py-2 text-sm font-semibold rounded-md ${theme.accent} ${theme.accentText} hover:bg-blue-700 transition-colors`}>
                                Ajouter l'outil
                            </button>
                        </div>
                    </div>

                    {/* Section Liste des outils */}
                    <div className="mt-8">
                        <h4 className={`font-semibold mb-3 ${theme.subtleText}`}>Outils configurés ({tools.length})</h4>
                        {tools.length > 0 ? (
                            <ul className="space-y-2">
                                {tools.map(tool => (
                                    <li key={tool.id} className={`group flex items-center justify-between p-3 rounded-md ${theme.hover} border ${theme.border}`}>
                                        <div className="flex items-center space-x-3">
                                            <span className={`w-3 h-3 rounded-full ${tool.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`} title={tool.status === 'active' ? 'Actif' : 'Inactif'}></span>
                                            <div>
                                                <p className="font-medium">{tool.name}</p>
                                                <p className={`text-xs ${theme.subtleText}`}>{tool.description || 'Pas de description'}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <button
                                                onClick={() => onUpdateToolStatus(tool.id, tool.status === 'active' ? 'inactive' : 'active')}
                                                className={`px-3 py-1 text-xs rounded-full transition-colors ${tool.status === 'active' ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'}`}
                                            >
                                                {tool.status === 'active' ? 'Désactiver' : 'Activer'}
                                            </button>
                                            <button onClick={() => onDeleteTool(tool.id)} className="opacity-0 group-hover:opacity-100 text-red-500 transition-opacity"><Trash2 className="w-4 h-4"/></button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className={`text-sm ${theme.subtleText}`}>Aucun outil n'a été configuré.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Composant Popup pour la Gestion des Agents ---
const AgentsManagerPopup = ({ isOpen, onClose, theme, agents, allTools, onAddAgent, onUpdateAgentStatus, onDeleteAgent, onSelectActiveAgent, activeAgentId }) => {
    if (!isOpen) return null;

    const [newAgentName, setNewAgentName] = useState('');
    const [newAgentProfessionPrompt, setNewAgentProfessionPrompt] = useState('');
    const [selectedToolIds, setSelectedToolIds] = useState([]);

    useEffect(() => {
        setNewAgentName('');
        setNewAgentProfessionPrompt('');
        setSelectedToolIds([]);
    }, [isOpen]);

    const handleAddAgent = () => {
        if (!newAgentName.trim() || !newAgentProfessionPrompt.trim()) {
            alert('Le nom de l\'agent et le prompt de profession sont requis.');
            return;
        }
        onAddAgent({
            name: newAgentName.trim(),
            professionPrompt: newAgentProfessionPrompt.trim(),
            toolIds: selectedToolIds,
            status: 'inactive'
        });
        setNewAgentName('');
        setNewAgentProfessionPrompt('');
        setSelectedToolIds([]);
    };

    const handleToolCheckboxChange = (toolId) => {
        setSelectedToolIds(prev =>
            prev.includes(toolId) ? prev.filter(id => id !== toolId) : [...prev, toolId]
        );
    };

    const activeTools = allTools.filter(t => t.status === 'active');

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className={`${theme.card} border ${theme.border} rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col`}>
                <div className={`p-5 border-b ${theme.border} flex items-center justify-between`}>
                    <h3 className="text-lg font-semibold">Gestionnaire d'Agents</h3>
                    <button onClick={onClose}><X className="w-6 h-6" /></button>
                </div>
                <div className="p-5 space-y-6 overflow-y-auto">
                    {/* Section Ajouter un nouvel agent */}
                    <div>
                        <h4 className={`font-semibold mb-3 ${theme.subtleText}`}>Ajouter un nouvel agent</h4>
                        <div className="space-y-3">
                            <div>
                                <label htmlFor="agentName" className={`block text-sm font-medium mb-1 ${theme.text}`}>Nom de l'agent</label>
                                <input
                                    type="text"
                                    id="agentName"
                                    value={newAgentName}
                                    onChange={(e) => setNewAgentName(e.target.value)}
                                    placeholder="Ex: Développeur Senior, Analyste Financier"
                                    className={`w-full bg-transparent border ${theme.border} rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500`}
                                />
                            </div>
                            <div>
                                <label htmlFor="agentProfessionPrompt" className={`block text-sm font-medium mb-1 ${theme.text}`}>Prompt de Profession</label>
                                <textarea
                                    id="agentProfessionPrompt"
                                    value={newAgentProfessionPrompt}
                                    onChange={(e) => setNewAgentProfessionPrompt(e.target.value)}
                                    placeholder="Ex: Agis comme un développeur Python senior. Réponds avec des extraits de code et des explications techniques."
                                    rows="4"
                                    className={`w-full bg-transparent border ${theme.border} rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500`}
                                ></textarea>
                            </div>
                            <div>
                                <h5 className={`font-medium mb-2 ${theme.subtleText}`}>Outils disponibles pour cet agent (actifs seulement)</h5>
                                {activeTools.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        {activeTools.map(tool => (
                                            <label key={tool.id} className={`flex items-center space-x-2 p-2 rounded-md ${theme.hover} cursor-pointer`}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedToolIds.includes(tool.id)}
                                                    onChange={() => handleToolCheckboxChange(tool.id)}
                                                    className="form-checkbox h-4 w-4 text-blue-600 rounded"
                                                />
                                                <span className="text-sm">{tool.name}</span>
                                            </label>
                                        ))}
                                    </div>
                                ) : (
                                    <p className={`text-sm ${theme.subtleText}`}>Aucun outil actif disponible. Ajoutez-en via le gestionnaire d'outils.</p>
                                )}
                            </div>
                            <button onClick={handleAddAgent} className={`px-4 py-2 text-sm font-semibold rounded-md ${theme.accent} ${theme.accentText} hover:bg-blue-700 transition-colors`}>
                                Ajouter l'agent
                            </button>
                        </div>
                    </div>

                    {/* Section Liste des agents */}
                    <div className="mt-8">
                        <h4 className={`font-semibold mb-3 ${theme.subtleText}`}>Agents configurés ({agents.length})</h4>
                        {agents.length > 0 ? (
                            <ul className="space-y-2">
                                {agents.map(agent => (
                                    <li key={agent.id} className={`group flex flex-col p-3 rounded-md ${theme.hover} border ${theme.border}`}>
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center space-x-3">
                                                <span className={`w-3 h-3 rounded-full ${agent.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`} title={agent.status === 'active' ? 'Actif' : 'Inactif'}></span>
                                                <div>
                                                    <p className="font-medium">{agent.name}</p>
                                                    <p className={`text-xs ${theme.subtleText}`}>{agent.professionPrompt.substring(0, 50)}...</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <button
                                                    onClick={() => onUpdateAgentStatus(agent.id, agent.status === 'active' ? 'inactive' : 'active')}
                                                    className={`px-3 py-1 text-xs rounded-full transition-colors ${agent.status === 'active' ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'}`}
                                                >
                                                    {agent.status === 'active' ? 'Désactiver' : 'Activer'}
                                                </button>
                                                <button
                                                    onClick={() => onSelectActiveAgent(agent.id)}
                                                    className={`px-3 py-1 text-xs rounded-full transition-colors ${activeAgentId === agent.id ? 'bg-blue-600 text-white' : `${theme.accent} ${theme.accentText} hover:bg-blue-700`}`}
                                                >
                                                    {activeAgentId === agent.id ? 'Agent Actif' : 'Activer'}
                                                </button>
                                                <button onClick={() => onDeleteAgent(agent.id)} className="opacity-0 group-hover:opacity-100 text-red-500 transition-opacity"><Trash2 className="w-4 h-4"/></button>
                                            </div>
                                        </div>
                                        {agent.toolIds && agent.toolIds.length > 0 && (
                                            <div className={`mt-2 text-xs ${theme.subtleText}`}>
                                                Outils associés: {agent.toolIds.map(toolId => allTools.find(t => t.id === toolId)?.name || toolId.substring(0, 4) + '...').join(', ')}
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className={`text-sm ${theme.subtleText}`}>Aucun agent n'a été configuré.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};


// --- Composant Popup pour le Gestionnaire de Modèles Personnalisés ---
const CustomModelsManagerPopup = ({ isOpen, onClose, theme, customModels, onAddCustomModel, onDeleteCustomModel }) => {
    if (!isOpen) return null;

    const [newModelName, setNewModelName] = useState('');
    const [newModelBaseUrl, setNewModelBaseUrl] = useState('');

    const handleAddModel = () => {
        if (!newModelName.trim() || !newModelBaseUrl.trim()) {
            alert('Le nom du modèle et l\'URL de base sont requis.');
            return;
        }
        onAddCustomModel({
            id: `custom-api-${Date.now()}`, // Unique ID for the custom model
            name: newModelName.trim(),
            type: 'Custom',
            baseUrl: newModelBaseUrl.trim()
        });
        setNewModelName('');
        setNewModelBaseUrl('');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className={`${theme.card} border ${theme.border} rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col`}>
                <div className={`p-5 border-b ${theme.border} flex items-center justify-between`}>
                    <h3 className="text-lg font-semibold">Gestionnaire de Modèles Personnalisés</h3>
                    <button onClick={onClose}><X className="w-6 h-6" /></button>
                </div>
                <div className="p-5 space-y-6 overflow-y-auto">
                    {/* Section Ajouter un nouveau modèle personnalisé */}
                    <div>
                        <h4 className={`font-semibold mb-3 ${theme.subtleText}`}>Ajouter un nouveau modèle personnalisé</h4>
                        <div className="space-y-3">
                            <div>
                                <label htmlFor="customModelName" className={`block text-sm font-medium mb-1 ${theme.text}`}>Nom du modèle</label>
                                <input
                                    type="text"
                                    id="customModelName"
                                    value={newModelName}
                                    onChange={(e) => setNewModelName(e.target.value)}
                                    placeholder="Ex: Grok, MonAPI_Locale"
                                    className={`w-full bg-transparent border ${theme.border} rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500`}
                                />
                            </div>
                            <div>
                                <label htmlFor="customModelBaseUrl" className={`block text-sm font-medium mb-1 ${theme.text}`}>URL de Base de l'API</label>
                                <input
                                    type="text"
                                    id="customModelBaseUrl"
                                    value={newModelBaseUrl}
                                    onChange={(e) => setNewModelBaseUrl(e.target.value)}
                                    placeholder="Ex: https://api.grok.ai/v1 ou http://localhost:8000/v1"
                                    className={`w-full bg-transparent border ${theme.border} rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500`}
                                />
                            </div>
                            <button onClick={handleAddModel} className={`px-4 py-2 text-sm font-semibold rounded-md ${theme.accent} ${theme.accentText} hover:bg-blue-700 transition-colors`}>
                                Ajouter le modèle
                            </button>
                        </div>
                    </div>

                    {/* Section Liste des modèles personnalisés */}
                    <div className="mt-8">
                        <h4 className={`font-semibold mb-3 ${theme.subtleText}`}>Modèles Personnalisés configurés ({customModels.length})</h4>
                        {customModels.length > 0 ? (
                            <ul className="space-y-2">
                                {customModels.map(model => (
                                    <li key={model.id} className={`group flex items-center justify-between p-3 rounded-md ${theme.hover} border ${theme.border}`}>
                                        <div>
                                            <p className="font-medium">{model.name}</p>
                                            <p className={`text-xs ${theme.subtleText} truncate max-w-xs`}>{model.baseUrl}</p>
                                        </div>
                                        <button onClick={() => onDeleteCustomModel(model.id)} className="opacity-0 group-hover:opacity-100 text-red-500 transition-opacity"><Trash2 className="w-4 h-4"/></button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className={`text-sm ${theme.subtleText}`}>Aucun modèle personnalisé n'a été configuré.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};


// --- Composant Popup pour les Serveurs MCP et Outils Google ---
const MCPServerToolsPopup = ({ isOpen, onClose, theme, mcpServers, onAddServer, onRemoveServer }) => {
    if (!isOpen) return null;

    const [newServerUrl, setNewServerUrl] = useState('');

    const handleAddServerClick = () => {
        if (newServerUrl.trim()) {
            onAddServer(newServerUrl.trim());
            setNewServerUrl('');
        }
    };

    const googleTools = [
        { id: 'search', name: 'Google Search', icon: Search, description: 'Recherche d\'informations sur le web.' },
        { id: 'mail', name: 'Gmail', icon: Mail, description: 'Gestion de vos e-mails.' },
        { id: 'calendar', name: 'Google Calendar', icon: Calendar, description: 'Organisation de votre emploi du temps.' },
        { id: 'drive', name: 'Google Drive', icon: Cloud, description: 'Stockage et partage de fichiers dans le cloud.' },
        { id: 'maps', name: 'Google Maps', icon: MapPin, description: 'Navigation et exploration de lieux.' },
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className={`${theme.card} border ${theme.border} rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col`}>
                <div className={`p-5 border-b ${theme.border} flex items-center justify-between`}>
                    <h3 className="text-lg font-semibold">Serveurs MCP & Outils Google</h3>
                    <button onClick={onClose}><X className="w-6 h-6" /></button>
                </div>
                <div className="p-5 space-y-6 overflow-y-auto">
                    {/* Section Serveurs MCP */}
                    <div>
                        <h4 className={`font-semibold mb-3 ${theme.subtleText} flex items-center space-x-2`}>
                            <Network className="w-5 h-5 text-blue-400" />
                            <span>Serveurs MCP</span>
                        </h4>
                        <div className="flex items-center gap-2 mb-4">
                            <input
                                type="text"
                                value={newServerUrl}
                                onChange={(e) => setNewServerUrl(e.target.value)}
                                placeholder="Ajouter une URL de serveur MCP (ex: http://localhost:8000)"
                                className={`flex-1 bg-transparent border ${theme.border} rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500`}
                            />
                            <button onClick={handleAddServerClick} className={`px-4 py-1.5 text-sm font-semibold rounded-md ${theme.accent} ${theme.accentText}`}>Ajouter</button>
                        </div>
                        <div className="space-y-2">
                            {mcpServers.length > 0 ? mcpServers.map((server, index) => (
                                <div key={index} className={`group flex items-center justify-between p-3 rounded-md ${theme.hover}`}>
                                    <span className="flex-1 text-sm truncate">{server}</span>
                                    <button onClick={() => onRemoveServer(server)} className="opacity-0 group-hover:opacity-100 text-red-500 transition-opacity"><Trash2 className="w-4 h-4"/></button>
                                </div>
                            )) : <p className={`text-sm ${theme.subtleText}`}>Aucun serveur configuré.</p>}
                        </div>
                    </div>

                    {/* Section Outils Google */}
                    <div className="mt-8">
                        <h4 className={`font-semibold mb-3 ${theme.subtleText} flex items-center space-x-2`}>
                            <Globe className="w-5 h-5 text-green-400" />
                            <span>Outils Google (Déjà Implémentés)</span>
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {googleTools.map(tool => (
                                <div key={tool.id} className={`${theme.card} border ${theme.border} rounded-lg p-4 flex items-center space-x-3`}>
                                    <tool.icon className="w-6 h-6 text-indigo-400" />
                                    <div>
                                        <h5 className="font-medium">{tool.name}</h5>
                                        <p className={`text-xs ${theme.subtleText}`}>{tool.description}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Nouveau Composant Popup pour le Guide d'Onboarding MCP ---
const MCPOnboardingGuidePopup = ({ isOpen, onClose, theme }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className={`${theme.card} border ${theme.border} rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col`}>
                <div className={`p-5 border-b ${theme.border} flex items-center justify-between`}>
                    <h3 className="text-lg font-semibold">Guide d'Onboarding pour le Protocole MCP</h3>
                    <button onClick={onClose}><X className="w-6 h-6" /></button>
                </div>
                <div className="p-5 space-y-6 overflow-y-auto">
                    <div>
                        <h4 className={`font-semibold mb-3 ${theme.subtleText}`}>Qu'est-ce que le Protocole MCP ?</h4>
                        <p className="text-sm">
                            Le Model Context Protocol (MCP) est un protocole conçu pour permettre aux modèles d'IA d'interagir de manière fluide et sécurisée avec des sources de données externes, des outils et des services. Il fournit un cadre standardisé pour que les modèles puissent comprendre et utiliser le "contexte" nécessaire à des réponses plus riches et plus pertinentes. Pensez-y comme un langage universel pour que les IA puissent accéder et manipuler des informations du monde réel.
                        </p>
                    </div>

                    <div>
                        <h4 className={`font-semibold mb-3 ${theme.subtleText}`}>Bonnes Pratiques DevOps pour MCP</h4>
                        <p className="text-sm mb-4">
                            L'implémentation de serveurs MCP dans un environnement de production nécessite une approche robuste, inspirée des principes DevOps.
                        </p>
                        <ol className="list-decimal list-inside space-y-3 text-sm">
                            <li>
                                <strong className="block mb-1">1. Obtenir les Accréditations Nécessaires :</strong>
                                Pour connecter votre application à un serveur MCP, vous aurez besoin d'informations d'identité et d'accès. Cela inclus généralement :
                                <ul className="list-disc list-inside ml-4 mt-1 space-y-0.5">
                                    <li>**URL du Serveur MCP :** L'adresse réseau de votre instance de serveur MCP (ex: `https://api.mon-mcp.com`).</li>
                                    <li>**Clé API (API Key) :** Un jeton unique qui authentifie votre application auprès du serveur. (À gérer comme un secret !)</li>
                                    <li>**ID d'Environnement/Projet :** Si votre déploiement MCP utilise des environnements distincts (développement, staging, production), un ID pour spécifier l'environnement cible.</li>
                                </ul>
                                <p className={`mt-1 ${theme.subtleText}`}>
                                    *Directive DevOps :* Ces accréditations devraient être gérées via un gestionnaire de secrets (ex: HashiCorp Vault, AWS Secrets Manager) et injectées dans votre application au moment du déploiement, jamais codées en dur.
                                </p>
                            </li>
                            <li>
                                <strong className="block mb-1">2. Provisionnement Automatisé du Serveur :</strong>
                                Dans un pipeline DevOps, le déploiement de serveurs MCP devrait être automatisé.
                                <ul className="list-disc list-inside ml-4 mt-1 space-y-0.5">
                                    <li>**Infrastructure as Code (IaC) :** Utilisez des outils comme Terraform, CloudFormation ou Ansible pour définir et provisionner votre infrastructure MCP de manière reproductible.</li>
                                    <li>**CI/CD :** Intégrez le déploiement du serveur MCP dans vos pipelines d'intégration continue/déploiement continu (CI/CD) pour des mises à jour rapides et fiables.</li>
                                </ul>
                                <p className={`mt-1 ${theme.subtleText}`}>
                                    *Directive DevOps :* Évitez la configuration manuelle des serveurs. L'automatisation réduit les erreurs et assure la cohérence entre les environnements.
                                </p>
                            </li>
                            <li>
                                <strong className="block mb-1">3. Configuration du Contexte et des Outils :</strong>
                                Le serveur MCP lui-même doit être configuré pour le connecter aux connecteurs et outils spécifiques (systèmes de fichiers, bases de données, APIs tierces).
                                <ul className="list-disc list-inside ml-4 mt-1 space-y-0.5">
                                    <li>Définissez les permissions et les configurations pour chaque connecteur activé.</li>
                                    <li>Assurez-vous que le serveur MCP a les autorisations réseau nécessaires pour atteindre ces ressources.</li>
                                </ul>
                                <p className={`mt-1 ${theme.subtleText}`}>
                                    *Directive DevOps :* Versionnez toutes les configurations du serveur MCP et gérez-les de la même manière que votre code.
                                </p>
                            </li>
                            <li>
                                <strong className="block mb-1">4. Surveillance et Observabilité :</strong>
                                Une fois déployé, un serveur MCP doit être activement surveillé.
                                <ul className="list-disc list-inside ml-4 mt-1 space-y-0.5">
                                    <li>**Logging :** Collectez les logs du serveur MCP pour le débogage et l'audit.</li>
                                    <li>**Monitoring :** Surveillez les métriques de performance (latence, utilisation des ressources) et l'état de la connexion aux sources de contexte.</li>
                                    <li>**Alerting :** Mettez en place des alertes pour les problèmes critiques.</li>
                                </ul>
                                <p className={`mt-1 ${theme.subtleText}`}>
                                    *Directive DevOps :* L'observabilité est clé pour la fiabilité. Assurez-vous de savoir ce qui se passe dans votre système MCP en temps réel.
                                </p>
                            </li>
                        </ol>
                    </div>

                    <div>
                        <h4 className={`font-semibold mb-3 ${theme.subtleText}`}>Comment Insérer les Informations d'Identité dans cette Démo ?</h4>
                        <p className="text-sm">
                            Dans cette application de démonstration, pour des raisons de simplicité et de sécurité (éviter de stocker de vraies clés API), nous ne vous demanderons pas d'insérer des informations d'identité réelles pour les outils Google ou l'API Gemini. L'API Key pour Gemini est gérée par l'environnement Canvas.
                            Pour les **Serveurs MCP**, vous pouvez simuler l'ajout d'une URL de serveur dans le popup "Serveurs MCP & Outils Google" (icône Réseau) comme si vous configuriez un point d'accès. Cependant, dans un scénario réel, les accréditations associées à cette URL seraient gérées de manière sécurisée en dehors de l'interface utilisateur.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Composant d'Indicateur d'État des Serveurs MCP ---
const MCPServerStatusIndicator = ({ mcpServers, theme }) => {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef(null);

    const getIndicatorColor = () => {
        if (mcpServers.length >= 3) return 'bg-green-500';
        if (mcpServers.length >= 1) return 'bg-yellow-500';
        return 'bg-red-500';
    };

    const handleButtonClick = () => {
        setIsDropdownOpen(prev => !prev);
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={handleButtonClick}
                className={`relative flex items-center space-x-2 px-3 py-1.5 rounded-md text-sm font-semibold ${theme.hover} transition-colors`}
            >
                <span className={`w-3 h-3 rounded-full ${getIndicatorColor()}`} />
                <span>MCP: {mcpServers.length}</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isDropdownOpen && (
                <div className={`absolute top-full right-0 mt-2 p-3 rounded-lg shadow-xl z-50 min-w-64 backdrop-blur-md ${theme.card} bg-opacity-80 border ${theme.border}`}>
                    <h4 className={`font-semibold mb-2 ${theme.subtleText}`}>Serveurs MCP Connectés</h4>
                    {mcpServers.length > 0 ? (
                        <ul className="space-y-2">
                            {mcpServers.map((server, index) => (
                                <li key={index} className="flex items-center space-x-2">
                                    <span className={`w-2.5 h-2.5 rounded-full ${getIndicatorColor()}`} />
                                    <span className="text-sm truncate">{server}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className={`text-sm ${theme.subtleText}`}>Aucun serveur actif.</p>
                    )}
                </div>
            )}
        </div>
    );
};

// --- Composant ErrorBoundary ---
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        console.error("Erreur non capturée par ErrorBoundary:", error, errorInfo);
        this.setState({ error: error, errorInfo: errorInfo });
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center min-h-screen bg-red-900 text-white p-4 text-center">
                    <h2 className="text-2xl font-bold mb-4">Oups ! Une erreur est survenue.</h2>
                    <p className="mb-4">
                        Nous sommes désolés pour le désagrément. Veuillez réessayer ou contacter le support si le problème persiste.
                    </p>
                    {this.props.children && (
                         <details className="mt-4 text-left p-4 bg-red-800 rounded-lg max-w-lg overflow-auto">
                            <summary className="font-semibold cursor-pointer">Détails de l'erreur (pour les développeurs)</summary>
                            <pre className="mt-2 whitespace-pre-wrap break-words text-sm">
                                {this.state.error && this.state.error.toString()}
                                <br />
                                {this.state.errorInfo && this.state.errorInfo.componentStack}
                            </pre>
                        </details>
                    )}

                </div>
            );
        }

        return this.props.children;
    }
}

// --- Composant Principal du Client de Chat MCP ---
const MCPChatClient = () => {
  // Initialisation de Firebase une seule fois
  const [firebaseApp, setFirebaseApp] = useState(null);
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  // Nouvelle état pour le statut d'authentification
  const [authStatus, setAuthStatus] = useState('loading'); // 'loading', 'authenticated', 'unauthenticated', 'error'


  // Nouvel état pour les outils et agents
  const [tools, setTools] = useState([]);
  const [agents, setAgents] = useState([]);
  const [activeAgent, setActiveAgent] = useState(null);
  const [customModels, setCustomModels] = useState([]);
  const [contextPills, setContextPills] = useState([]); // New state for context pills

  useEffect(() => {
    let unsubscribeAuth = () => {};
    let unsubscribeProfile = () => {};
    let unsubscribeTools = () => {};
    let unsubscribeAgents = () => {};
    let unsubscribeCustomModels = () => {};
    let unsubscribeContextPills = () => {}; // New unsubscribe for context pills

    const initializeFirebase = async () => {
      try {
        const app = initializeApp(firebaseConfig);
        const firestoreDb = getFirestore(app);
        const firebaseAuth = getAuth(app);

        setFirebaseApp(app);
        setDb(firestoreDb);
        setAuth(firebaseAuth);

        unsubscribeAuth = onAuthStateChanged(firebaseAuth, async (user) => {
          let currentUserId = null;
          if (user) {
              currentUserId = user.uid;
              console.log("onAuthStateChanged: User already signed in:", currentUserId);
              setAuthStatus('authenticated');
          } else {
              try {
                  if (initialAuthToken) {
                      console.log("onAuthStateChanged: Signing in with custom token...");
                      await signInWithCustomToken(firebaseAuth, initialAuthToken);
                  } else {
                      console.log("onAuthStateChanged: Signing in anonymously...");
                      await signInAnonymously(firebaseAuth);
                  }
                  currentUserId = firebaseAuth.currentUser?.uid;
                  if (currentUserId) {
                      console.log("onAuthStateChanged: Auth successful, currentUserId:", currentUserId);
                      setAuthStatus('authenticated');
                  } else {
                      console.warn("onAuthStateChanged: Auth attempted but no user ID obtained. Defaulting to unauthenticated.");
                      setAuthStatus('unauthenticated');
                  }
              } catch (anonError) {
                  console.error("Erreur lors de l'authentification (anonyme ou jeton):", anonError);
                  setAuthStatus('error');
                  currentUserId = crypto.randomUUID(); // Fallback for display, not for auth
                  console.warn("Authentication failed, using random UUID as fallback for display:", currentUserId);
              }
          }

          setUserId(currentUserId);
          setIsAuthReady(true); // Firebase auth listener has completed its first run

          if (currentUserId && authStatus === 'authenticated') { // Only set up listeners if actually authenticated
            const profileRef = doc(firestoreDb, `artifacts/${appId}/users/${currentUserId}/profile/data`);
            unsubscribeProfile = onSnapshot(profileRef, async (docSnap) => {
                console.log("Profile snapshot received. Exists:", docSnap.exists());
                if (docSnap.exists()) {
                    const profileData = docSnap.data();
                    setUserProfile(profileData);
                    if (profileData.activeAgentId) {
                        const foundAgent = agents.find(a => a.id === profileData.activeAgentId);
                        setActiveAgent(foundAgent || null);
                    } else {
                        setActiveAgent(null);
                    }
                } else {
                    const defaultDisplayName = `Utilisateur Anonyme ${currentUserId.substring(0, 4)}`;
                    await setDoc(profileRef, {
                        displayName: defaultDisplayName,
                        createdAt: serverTimestamp(),
                        openaiConfig: { apiKey: '', baseUrl: '' },
                        anthropicConfig: { apiKey: '', baseUrl: '' },
                        activeAgentId: null
                    }, { merge: true });
                    setUserProfile({ displayName: defaultDisplayName, openaiConfig: { apiKey: '', baseUrl: '' }, anthropicConfig: { apiKey: '', baseUrl: '' }, activeAgentId: null });
                    console.log("Profile created with default displayName.");
                }
            }, (error) => {
                console.error("Erreur lors de l'écoute du profil utilisateur Firestore:", error);
                // Do not set userProfile to "Erreur de Chargement" if auth fails, authStatus handles general error
            });

            const toolsColRef = collection(firestoreDb, `artifacts/${appId}/users/${currentUserId}/tools`);
            unsubscribeTools = onSnapshot(toolsColRef, (snapshot) => {
                const loadedTools = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setTools(loadedTools);
                console.log("Tools loaded:", loadedTools.length);
            }, (error) => console.error("Error loading tools:", error));

            const agentsColRef = collection(firestoreDb, `artifacts/${appId}/users/${currentUserId}/agents`);
            unsubscribeAgents = onSnapshot(agentsColRef, (snapshot) => {
                const loadedAgents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setAgents(loadedAgents);
                console.log("Agents loaded:", loadedAgents.length);
            }, (error) => console.error("Error loading agents:", error));

            const customModelsColRef = collection(firestoreDb, `artifacts/${appId}/users/${currentUserId}/customModels`);
            unsubscribeCustomModels = onSnapshot(customModelsColRef, (snapshot) => {
                const loadedCustomModels = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setCustomModels(loadedCustomModels);
                console.log("Custom models loaded:", loadedCustomModels.length);
            }, (error) => console.error("Error loading custom models:", error));

            const contextPillsColRef = collection(firestoreDb, `artifacts/${appId}/users/${currentUserId}/contextPills`);
            unsubscribeContextPills = onSnapshot(contextPillsColRef, (snapshot) => {
                const loadedContextPills = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setContextPills(loadedContextPills);
                console.log("Context pills loaded:", loadedContextPills.length);
            }, (error) => console.error("Error loading context pills:", error));

          } else {
              // If not authenticated, ensure profile and other data is reset
              setUserProfile(null);
              setTools([]);
              setAgents([]);
              setCustomModels([]);
              setContextPills([]);
          }
        });

      } catch (firebaseError) {
        console.error("Erreur d'initialisation de Firebase:", firebaseError);
        setIsAuthReady(true);
        setAuthStatus('error');
        setUserId(crypto.randomUUID()); // Fallback for display
      }
    };

    initializeFirebase();

    return () => {
        console.log("Cleaning up Firebase listeners.");
        unsubscribeAuth();
        unsubscribeProfile();
        unsubscribeTools();
        unsubscribeAgents();
        unsubscribeCustomModels();
        unsubscribeContextPills();
    };
  }, []); // Empty dependency array means this runs only once on mount


  useEffect(() => {
    // This effect ensures activeAgent is correctly set when agents or userProfile changes.
    // It should run whenever agents array or userProfile?.activeAgentId changes.
    if (userProfile?.activeAgentId && agents.length > 0) {
        const foundAgent = agents.find(a => a.id === userProfile.activeAgentId);
        setActiveAgent(foundAgent || null);
    } else if (!userProfile?.activeAgentId) {
        setActiveAgent(null);
    }
  }, [userProfile?.activeAgentId, agents]);


  const {
    conversations,
    currentConversationId,
    setCurrentConversationId,
    currentChatHistory,
    createNewConversation,
    deleteConversation,
    sendMessage,
    isLoading: isChatLoading,
    activeConnectors,
    setActiveConnectors,
    connectors,
    powers,
    setSystemPromptForCurrentConversation,
    currentSystemPrompt
  } = useMcpChat(db, auth, userId, isAuthReady, activeAgent, tools, userProfile?.anthropicConfig, customModels, authStatus); // Pass authStatus to the hook


  const [darkMode, setDarkMode] = useState(true);
  const [message, setMessage] = useState('');
  const [isHistoryOpen, setIsHistoryOpen] = useState(true);
  const [isSettingsOpen, setIsSettings] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gpt-3.5-turbo');
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isPromptManagerOpen, setIsPromptManagerOpen] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [isServerToolsOpen, setIsServerToolsOpen] = useState(false);
  const [isOnboardingGuideOpen, setIsOnboardingGuideOpen] = useState(false);
  const [isPaperclipDropdownOpen, setIsPaperclipDropdownOpen] = useState(false);
  const [showConversationStarters, setShowConversationStarters] = useState(true);

  const [isToolsManagerOpen, setIsToolsManagerOpen] = useState(false);
  const [isAgentsManagerOpen, setIsAgentsManagerOpen] = useState(false);
  const [isCustomModelsManagerOpen, setIsCustomModelsManagerOpen] = useState(false);
  const [isContextPillsManagerOpen, setIsContextPillsManagerOpen] = useState(false); // New state for context pills popup


  const [customPrompts, setCustomPrompts] = useState([]);
  const [mcpServers, setMcpServers] = useState([]);

  const [newDisplayName, setNewDisplayName] = useState(userProfile?.displayName || '');
  const [openaiApiKey, setOpenaiApiKey] = useState(userProfile?.openaiConfig?.apiKey || '');
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState(userProfile?.openaiConfig?.baseUrl || '');
  const [anthropicApiKey, setAnthropicApiKey] = useState(userProfile?.anthropicConfig?.apiKey || '');
  const [anthropicBaseUrl, setAnthropicBaseUrl] = useState(userProfile?.anthropicConfig?.baseUrl || '');

  const handleSaveProfile = async () => {
    if (!db || !userId || authStatus !== 'authenticated') return;
    try {
      const profileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
      await setDoc(profileRef, {
        displayName: newDisplayName.trim(),
        openaiConfig: {
          apiKey: openaiApiKey.trim(),
          baseUrl: openaiBaseUrl.trim()
        },
        anthropicConfig: {
            apiKey: anthropicApiKey.trim(),
            baseUrl: anthropicBaseUrl.trim()
        },
        lastUpdated: serverTimestamp()
      }, { merge: true });
      console.log("Profil utilisateur sauvegardé.");
    } catch (error) {
      console.error("Erreur lors de la sauvegarde du profil:", error);
    }
  };

  useEffect(() => {
    if (isSettingsOpen && userProfile) {
      setNewDisplayName(userProfile.displayName || '');
      setOpenaiApiKey(userProfile.openaiConfig?.apiKey || '');
      setOpenaiBaseUrl(userProfile.openaiConfig?.baseUrl || '');
      setAnthropicApiKey(userProfile.anthropicConfig?.apiKey || '');
      setAnthropicBaseUrl(userProfile.anthropicConfig?.baseUrl || '');
    }
  }, [isSettingsOpen, userProfile]);

  useEffect(() => {
    // Only reset if settings are closed AND userProfile exists (to avoid setting to empty on first load)
    if (!isSettingsOpen && userProfile) {
      setNewDisplayName(userProfile.displayName || '');
      setOpenaiApiKey(userProfile.openaiConfig?.apiKey || '');
      setOpenaiBaseUrl(userProfile.openaiConfig?.baseUrl || '');
      setAnthropicApiKey(userProfile.anthropicConfig?.apiKey || '');
      setAnthropicBaseUrl(userProfile.anthropicConfig?.baseUrl || '');
    }
  }, [userProfile, isSettingsOpen]);


  useEffect(() => {
    if (!db || !userId || authStatus !== 'authenticated') return;

    const customPromptsColRef = collection(db, `artifacts/${appId}/users/${userId}/customPrompts`);
    const unsubscribePrompts = onSnapshot(customPromptsColRef, (snapshot) => {
        const loadedPrompts = [];
        snapshot.forEach(doc => {
            loadedPrompts.push(doc.data().text);
        });
        setCustomPrompts(loadedPrompts);
    }, (error) => console.error("Erreur lors de l'écoute des prompts personnalisés Firestore:", error));

    const mcpServersColRef = collection(db, `artifacts/${appId}/users/${userId}/mcpServers`);
    const unsubscribeServers = onSnapshot(mcpServersColRef, (snapshot) => {
        const loadedServers = [];
        snapshot.forEach(doc => {
            loadedServers.push(doc.data().url);
        });
        setMcpServers(loadedServers);
    }, (error) => console.error("Erreur lors de l'écoute des serveurs MCP Firestore:", error));

    return () => {
        unsubscribePrompts();
        unsubscribeServers();
    };
  }, [db, userId, authStatus]); // Added authStatus to dependencies

  // --- Fonctions de gestion des Outils ---
  const handleAddTool = async (toolData) => {
    if (!db || !userId || authStatus !== 'authenticated') return;
    try {
        await addDoc(collection(db, `artifacts/${appId}/users/${userId}/tools`), {
            ...toolData,
            createdAt: serverTimestamp(),
            lastUpdated: serverTimestamp()
        });
        console.log("Outil ajouté:", toolData.name);
    } catch (error) {
        console.error("Erreur lors de l'ajout de l'outil:", error);
    }
  };

  const handleUpdateToolStatus = async (toolId, newStatus) => {
    if (!db || !userId || authStatus !== 'authenticated') return;
    try {
        const toolRef = doc(db, `artifacts/${appId}/users/${userId}/tools`, toolId);
        await setDoc(toolRef, { status: newStatus, lastUpdated: serverTimestamp() }, { merge: true });
        console.log(`Statut de l'outil ${toolId} mis à jour à ${newStatus}`);
    } catch (error) {
        console.error("Erreur lors de la mise à jour du statut de l'outil:", error);
    }
  };

  const handleDeleteTool = async (toolId) => {
    if (!db || !userId || authStatus !== 'authenticated') return;
    try {
        await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/tools`, toolId));
        console.log(`Outil ${toolId} supprimé.`);
    } catch (error) {
        console.error("Erreur lors de la suppression de l'outil:", error);
    }
  };

  // --- Fonctions de gestion des Agents ---
  const handleAddAgent = async (agentData) => {
    if (!db || !userId || authStatus !== 'authenticated') return;
    try {
        await addDoc(collection(db, `artifacts/${appId}/users/${userId}/agents`), {
            ...agentData,
            createdAt: serverTimestamp(),
            lastUpdated: serverTimestamp()
        });
        console.log("Agent ajouté:", agentData.name);
    } catch (error) {
        console.error("Erreur lors de l'ajout de l'agent:", error);
    }
  };

  const handleUpdateAgentStatus = async (agentId, newStatus) => {
    if (!db || !userId || authStatus !== 'authenticated') return;
    try {
        const agentRef = doc(db, `artifacts/${appId}/users/${userId}/agents`, agentId);
        await setDoc(agentRef, { status: newStatus, lastUpdated: serverTimestamp() }, { merge: true });
        console.log(`Statut de l'agent ${agentId} mis à jour à ${newStatus}`);
    } catch (error) {
        console.error("Erreur lors de la mise à jour du statut de l'agent:", error);
    }
  };

  const handleDeleteAgent = async (agentId) => {
    if (!db || !userId || authStatus !== 'authenticated') return;
    try {
        await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/agents`, agentId));
        console.log(`Agent ${agentId} supprimé.`);
    } catch (error) {
      console.error("Erreur lors de la suppression de l'agent:", error);
    }
  };

  const handleSelectActiveAgent = async (agentId) => {
    if (!db || !userId || authStatus !== 'authenticated') return;
    try {
        const profileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
        const newActiveAgentId = userProfile?.activeAgentId === agentId ? null : agentId;
        await setDoc(profileRef, { activeAgentId: newActiveAgentId, lastUpdated: serverTimestamp() }, { merge: true });
        console.log(`Agent actif mis à jour: ${newActiveAgentId || 'aucun'}`);
    } catch (error) {
        console.error("Erreur lors de la sélection de l'agent actif:", error);
    }
  };

  // --- Fonctions de gestion des Modèles Personnalisés ---
  const handleAddCustomModel = async (modelData) => {
      if (!db || !userId || authStatus !== 'authenticated') return;
      try {
          await addDoc(collection(db, `artifacts/${appId}/users/${userId}/customModels`), {
              ...modelData,
              createdAt: serverTimestamp()
          });
          console.log("Modèle personnalisé ajouté:", modelData.name);
      } catch (error) {
          console.error("Erreur lors de l'ajout du modèle personnalisé:", error);
      }
  };

  const handleDeleteCustomModel = async (modelId) => {
      if (!db || !userId || authStatus !== 'authenticated') return;
      try {
          await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/customModels`, modelId));
          console.log(`Modèle personnalisé ${modelId} supprimé.`);
      } catch (error) {
          console.error("Erreur lors de la suppression du modèle personnalisé:", error);
      }
  };

  // --- Fonctions de gestion des Pastilles de Contexte ---
  const handleAddContextPill = async (contextPillData) => {
      if (!db || !userId || authStatus !== 'authenticated') return;
      try {
          await addDoc(collection(db, `artifacts/${appId}/users/${userId}/contextPills`), {
              ...contextPillData,
              createdAt: serverTimestamp()
          });
          console.log("Pastille de contexte ajoutée:", contextPillData.name);
      } catch (error) {
          console.error("Erreur lors de l'ajout de la pastille de contexte:", error);
      }
  };

  const handleDeleteContextPill = async (contextPillId) => {
      if (!db || !userId || authStatus !== 'authenticated') return;
      try {
          await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/contextPills`, contextPillId));
          console.log(`Pastille de contexte ${contextPillId} supprimée.`);
      } catch (error) {
          console.error("Erreur lors de la suppression de la pastille de contexte:", error);
      }
  };


  const handleAddPrompt = async (prompt) => {
    if (!db || !userId || authStatus !== 'authenticated') return;
    try {
      await addDoc(collection(db, `artifacts/${appId}/users/${userId}/customPrompts`), { text: prompt, createdAt: serverTimestamp() });
    } catch (error) {
      console.error("Erreur lors de l'ajout du prompt personnalisé:", error);
    }
  };

  const handleDeletePrompt = async (promptToDelete) => {
    if (!db || !userId || authStatus !== 'authenticated') return;
    try {
      const q = query(collection(db, `artifacts/${appId}/users/${userId}/customPrompts`), where("text", "==", promptToDelete));
      const querySnapshot = await getDocs(q);
      querySnapshot.forEach(async (document) => {
        await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/customPrompts`, document.id));
      });
    } catch (error) {
      console.error("Erreur lors de la suppression du prompt personnalisé:", error);
    }
  };

  const handleAddServer = async (serverUrl) => {
    if (!db || !userId || authStatus !== 'authenticated') return;
    try {
      await addDoc(collection(db, `artifacts/${appId}/users/${userId}/mcpServers`), { url: serverUrl, createdAt: serverTimestamp() });
    } catch (error) {
      console.error("Erreur lors de l'ajout du serveur MCP:", error);
    }
  };

  const handleRemoveServer = async (serverUrl) => {
    if (!db || !userId || authStatus !== 'authenticated') return;
    try {
      const q = query(collection(db, `artifacts/${appId}/users/${userId}/mcpServers`), where("url", "==", serverUrl));
      const querySnapshot = await getDocs(q);
      querySnapshot.forEach(async (document) => {
        await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/mcpServers`, document.id));
      });
    } catch (error) {
      console.error("Erreur lors de la suppression du serveur MCP:", error);
    }
  };


  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [currentChatHistory]);

  const handleSendMessage = () => {
    sendMessage(message, selectedModel, userProfile?.openaiConfig, userProfile?.anthropicConfig, customModels);
    setMessage('');
    setIsPaperclipDropdownOpen(false);
    setShowConversationStarters(false);
  };

  const handleSelectPrompt = (prompt) => {
      setMessage(prompt + " ");
      setIsPromptManagerOpen(false);
      inputRef.current?.focus();
      setShowConversationStarters(true);
  };

  const handleSelectSystemPrompt = useCallback((prompt) => {
    setSystemPromptForCurrentConversation(prompt);
    setIsContextPillsManagerOpen(false); // Close context manager after selection
  }, [setSystemPromptForCurrentConversation]);


  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      sendMessage(`Fichier "${file.name}" a été téléchargé.`, selectedModel, userProfile?.openaiConfig, userProfile?.anthropicConfig, customModels);
    }
    setIsPaperclipDropdownOpen(false);
  };

  const handleImageChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      const messageText = file.type.startsWith('image/') ? `Image "${file.name}" (ou Photo capturée) a été téléchargée.` : `Fichier multimédia "${file.name}" a été téléchargé.`
      sendMessage(messageText, selectedModel, userProfile?.openaiConfig, userProfile?.anthropicConfig, customModels);
    }
    setIsPaperclipDropdownOpen(false);
  };

  const handleMicToggle = () => {
    setIsMicActive(prev => !prev);
    const micStatus = isMicActive ? "désactivé" : "activé";
    sendMessage(`Microphone ${micStatus}.`, selectedModel, userProfile?.openaiConfig, userProfile?.anthropicConfig, customModels);
  };

  const handleLogout = async () => {
    if (auth) {
      try {
        await signOut(auth);
        console.log("Déconnexion réussie.");
        // Reset state after logout
        setUserId(null);
        setUserProfile(null);
        setAuthStatus('unauthenticated');
        setConversations({});
        setCurrentConversationId('');
        setTools([]);
        setAgents([]);
        setCustomModels([]);
        setContextPills([]);
        setCustomPrompts([]);
        setMcpServers([]);

      } catch (error) {
        console.error("Erreur lors de la déconnexion:", error);
      }
    }
  };


  // Amorces de conversation structurées en pyramide
  const pyramidConversationStarters = [
    // Top (1 courte)
    ["Bonjour !"],
    // Milieu (2 moyennes)
    ["Comment puis-je vous aider aujourd'hui ?", "Donnez-moi une brève explication sur l'IA."],
    // Base (3 longues)
    ["Rédigez un court paragraphe sur l'importance de l'énergie renouvelable.", "Quelles sont les dernières avancées technologiques en matière de véhicules électriques ?", "Décrivez les étapes clés pour planifier un voyage de rêve en Asie du Sud-Est."]
  ];

  const baseModels = {
    language: [
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', type: 'Google' },
    ],
    anthropic: [
      { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet', type: 'Anthropic' },
      { id: 'claude-3-opus', name: 'Claude 3 Opus', type: 'Anthropic' }
    ],
    openai: [
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', type: 'OpenAI' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', type: 'OpenAI' },
      { id: 'gpt-4o', name: 'GPT-4o', type: 'OpenAI' }
    ],
    simulated: [
      { id: 'claude-4-sonnet', name: 'Claude 4 Sonnet', type: 'Simulé' },
      { id: 'claude-4-opus', name: 'Claude 4 Opus', type: 'Simulé' },
      { id: 'gpt-4-turbo-code', name: 'GPT-4 Turbo Code', type: 'Simulé' }
    ]
  };

  // Combine base models with custom models from user profile
  const allAvailableModels = {
    ...baseModels,
    custom: customModels.length > 0 ? customModels : []
  };

  const currentTheme = darkMode
    ? {
        bg: 'bg-[#1a202c]',
        text: 'text-slate-200',
        card: 'bg-[#2d3748]',
        border: 'border-[#4a5568]',
        subtleText: 'text-slate-400',
        hover: 'hover:bg-[#4a5568]',
        accent: 'bg-[#00e6e6]',
        accentText: 'text-slate-900',
        glow: 'shadow-[0_0_15px_rgba(0,230,230,0.6)]',
        logoUrl: 'https://raw.githubusercontent.com/martianbandit/FleetCrew-Agentics/refs/heads/main/Logo%20futuriste%20de%20camion%20n%C3%A9on.png'
      }
    : {
        bg: 'bg-slate-50',
        text: 'text-slate-800',
        card: 'bg-white',
        border: 'border-slate-200',
        subtleText: 'text-slate-500',
        hover: 'hover:bg-slate-100',
        accent: 'bg-blue-600',
        accentText: 'text-white',
        glow: 'shadow-[0_0_15px_rgba(0,100,255,0.4)]',
        logoUrl: 'https://raw.githubusercontent.com/martianbandit/FleetCrew-Agentics/refs/heads/main/Logo%20de%20camion%20num%C3%A9rique%20lumineux.png'
    };

  const chatConversations = Object.values(conversations).filter(conv => conv.type === 'chat');
  const toolConversations = Object.values(conversations).filter(conv => conv.type === 'tool');
  const agentConversations = Object.values(conversations).filter(conv => conv.type === 'agent');

  // Affichage du statut de chargement/erreur d'authentification
  if (!isAuthReady || authStatus === 'loading') {
    return (
      <div className={`min-h-screen ${currentTheme.bg} ${currentTheme.text} flex items-center justify-center`}>
        <Loader2 className="w-16 h-16 text-blue-500 animate-spin" />
        <span className="ml-4 text-xl">Chargement de l'application...</span>
      </div>
    );
  } else if (authStatus === 'unauthenticated' || authStatus === 'error') {
    return (
        <div className={`min-h-screen ${currentTheme.bg} ${currentTheme.text} flex flex-col items-center justify-center p-4 text-center`}>
            <X className="w-16 h-16 text-red-500 mb-4" />
            <h2 className="text-2xl font-bold mb-2">Problème d'authentification</h2>
            <p className="mb-4">
                Nous n'avons pas pu vous connecter à l'application. Cela peut être dû à un problème avec votre jeton d'authentification
                ou les règles de sécurité de la base de données.
            </p>
            <p className="text-sm">Veuillez contacter le support si le problème persiste.</p>
             <button onClick={handleLogout} className={`mt-6 px-4 py-2 text-sm font-semibold rounded-md ${currentTheme.accent} ${currentTheme.accentText} hover:bg-blue-700 transition-colors`}>
                Réessayer la Connexion
            </button>
        </div>
    );
  }
  // Si authStatus est 'authenticated', le reste de l'application se rend.


  return (
    <div className={`min-h-screen ${currentTheme.bg} ${currentTheme.text} flex transition-colors duration-300 font-sans overflow-x-hidden`}>
      {/* Popup du Gestionnaire de Prompts */}
      <PromptManagerPopup
        isOpen={isPromptManagerOpen}
        onClose={() => setIsPromptManagerOpen(false)}
        onSelectPrompt={handleSelectPrompt}
        onSelectSystemPrompt={handleSelectSystemPrompt}
        customPrompts={customPrompts}
        onAddPrompt={handleAddPrompt}
        onDeletePrompt={handleDeletePrompt}
        theme={currentTheme}
      />

      {/* Popup de Gestion des Contextes (Pastilles) */}
      <ContextPillsManagerPopup
        isOpen={isContextPillsManagerOpen}
        onClose={() => setIsContextPillsManagerOpen(false)}
        onSelectContext={handleSelectSystemPrompt} // Reuses handleSelectSystemPrompt
        customContextPills={contextPills}
        onAddContextPill={handleAddContextPill}
        onDeleteContextPill={handleDeleteContextPill}
        theme={currentTheme}
        activeSystemPrompt={currentSystemPrompt}
      />

      {/* Popup de Gestion des Outils */}
      <ToolsManagerPopup
        isOpen={isToolsManagerOpen}
        onClose={() => setIsToolsManagerOpen(false)}
        theme={currentTheme}
        tools={tools}
        onAddTool={handleAddTool}
        onUpdateToolStatus={handleUpdateToolStatus}
        onDeleteTool={handleDeleteTool}
      />

      {/* Popup de Gestion des Agents */}
      <AgentsManagerPopup
        isOpen={isAgentsManagerOpen}
        onClose={() => setIsAgentsManagerOpen(false)}
        theme={currentTheme}
        agents={agents}
        allTools={tools}
        onAddAgent={handleAddAgent}
        onUpdateAgentStatus={handleUpdateAgentStatus}
        onDeleteAgent={handleDeleteAgent}
        onSelectActiveAgent={handleSelectActiveAgent}
        activeAgentId={userProfile?.activeAgentId}
      />

      {/* Nouveau Popup pour le Gestionnaire de Modèles Personnalisés */}
      <CustomModelsManagerPopup
        isOpen={isCustomModelsManagerOpen}
        onClose={() => setIsCustomModelsManagerOpen(false)}
        theme={currentTheme}
        customModels={customModels}
        onAddCustomModel={handleAddCustomModel}
        onDeleteCustomModel={handleDeleteCustomModel}
      />

      {/* Nouveau Popup pour les Serveurs MCP et Outils Google */}
      <MCPServerToolsPopup
        isOpen={isServerToolsOpen}
        onClose={() => setIsServerToolsOpen(false)}
        theme={currentTheme}
        mcpServers={mcpServers}
        onAddServer={handleAddServer}
        onRemoveServer={handleRemoveServer}
      />

      {/* Nouveau Popup pour le Guide d'Onboarding MCP */}
      <MCPOnboardingGuidePopup
        isOpen={isOnboardingGuideOpen}
        onClose={() => setIsOnboardingGuideOpen(false)}
        theme={currentTheme}
      />

      {/* Barre Latérale de l'Historique */}
      <aside className={`fixed top-0 left-0 h-full w-72 ${currentTheme.card} border-r ${currentTheme.border} transform transition-transform duration-300 z-40 ${isHistoryOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:translate-x-0`}>
        {/* En-tête de la Barre Latérale */}
        <div className={`p-4 border-b ${currentTheme.border} flex items-center justify-between h-14`}>
          {/* Bouton pour ouvrir/fermer le menu */}
          <button onClick={() => setIsHistoryOpen(!isHistoryOpen)} className={`p-1.5 rounded-md ${currentTheme.hover} transition-colors`}>
            {isHistoryOpen ? <X className="w-5 h-5" /> : <History className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2">
            {/* Bouton Paramètres */}
            <button onClick={() => setIsSettings(true)} className={`p-1.5 rounded-md ${currentTheme.hover} transition-colors`} title="Paramètres"><Settings className="w-5 h-5" /></button>
            {/* Bouton bascule Mode Sombre/Clair */}
            <button onClick={() => setDarkMode(!darkMode)} className={`p-1.5 rounded-md ${currentTheme.hover} transition-colors`} title="Changer de thème">{darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}</button>
            {/* Nouveau bouton pour ouvrir le Guide d'Onboarding MCP */}
            <button onClick={() => setIsOnboardingGuideOpen(true)} className={`p-1.5 rounded-md ${currentTheme.hover} transition-colors`} title="Guide d'Onboarding pour le Protocole MCP">
              <Cloud className="w-5 h-5" />
            </button>
            {/* Nouveau bouton pour ouvrir le popup Serveurs MCP & Outils Google */}
            <button onClick={() => setIsServerToolsOpen(true)} className={`p-1.5 rounded-md ${currentTheme.hover} transition-colors`} title="Gérer les serveurs MCP et outils Google">
              <Network className="w-5 h-5" />
            </button>
            {/* Nouveau bouton pour ouvrir le gestionnaire d'outils */}
            <button onClick={() => setIsToolsManagerOpen(true)} className={`p-1.5 rounded-md ${currentTheme.hover} transition-colors`} title="Gérer les outils API">
              <Wrench className="w-5 h-5" />
            </button>
             {/* Nouveau bouton pour ouvrir le gestionnaire d'agents */}
            <button onClick={() => setIsAgentsManagerOpen(true)} className={`p-1.5 rounded-md ${currentTheme.hover} transition-colors`} title="Gérer les agents IA">
              <Users className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Liste de Conversations */}
        <div className="p-2 space-y-4 overflow-y-auto h-[calc(100vh-108px)]">
          {/* Section Discussions */}
          <div>
            <h4 className={`font-semibold mb-2 ml-1 ${currentTheme.subtleText}`}>Discussions</h4>
            <div className="space-y-1">
                <button onClick={() => createNewConversation('chat')} className={`w-full text-left pl-3 pr-8 py-2 rounded-md transition-colors text-sm truncate ${currentTheme.hover}`} title="Nouvelle discussion de chat">
                    <PlusCircle className="inline-block w-4 h-4 mr-2" />Nouvelle discussion
                </button>
                {chatConversations.length > 0 ? chatConversations.map(conv => (
                    <div key={conv.id} className="group relative">
                        <button onClick={() => setCurrentConversationId(conv.id)} className={`w-full text-left pl-3 pr-8 py-2 rounded-md transition-colors text-sm truncate ${currentConversationId === conv.id ? `${currentTheme.accent} ${currentTheme.accentText}` : currentTheme.hover}`}>{conv.title}</button>
                        <button onClick={() => deleteConversation(conv.id)} className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity ${currentConversationId === conv.id ? `hover:bg-blue-500` : `hover:bg-slate-600`}`}><Trash2 className="w-4 h-4"/></button>
                    </div>
                )) : <p className={`text-sm ml-3 ${currentTheme.subtleText}`}>Aucune discussion.</p>}
            </div>
          </div>

          {/* Section Outils */}
          <div>
            <h4 className={`font-semibold mb-2 ml-1 ${currentTheme.subtleText}`}>Outils</h4>
            <div className="space-y-1">
                <button onClick={() => createNewConversation('tool', 'Nouvel Outil')} className={`w-full text-left pl-3 pr-8 py-2 rounded-md transition-colors text-sm truncate ${currentTheme.hover}`} title="Nouvel Outil">
                    <Code className="inline-block w-4 h-4 mr-2" />Nouvel Outil
                </button>
                {toolConversations.length > 0 ? toolConversations.map(conv => (
                    <div key={conv.id} className="group relative">
                        <button onClick={() => setCurrentConversationId(conv.id)} className={`w-full text-left pl-3 pr-8 py-2 rounded-md transition-colors text-sm truncate ${currentConversationId === conv.id ? `${currentTheme.accent} ${currentTheme.accentText}` : currentTheme.hover}`}>{conv.title}</button>
                        <button onClick={() => deleteConversation(conv.id)} className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity ${currentConversationId === conv.id ? `hover:bg-blue-500` : `hover:bg-slate-600`}`}><Trash2 className="w-4 h-4"/></button>
                    </div>
                )) : <p className={`text-sm ml-3 ${currentTheme.subtleText}`}>Aucun outil.</p>}
            </div>
          </div>

          {/* Section Agents */}
          <div>
            <h4 className={`font-semibold mb-2 ml-1 ${currentTheme.subtleText}`}>Agents</h4>
            <div className="space-y-1">
                <button onClick={() => createNewConversation('agent', 'Nouvel Agent')} className={`w-full text-left pl-3 pr-8 py-2 rounded-md transition-colors text-sm truncate ${currentTheme.hover}`} title="Nouvel Agent">
                    <Brain className="inline-block w-4 h-4 mr-2" />Nouvel Agent
                </button>
                {agentConversations.length > 0 ? agentConversations.map(conv => (
                    <div key={conv.id} className="group relative">
                        <button onClick={() => setCurrentConversationId(conv.id)} className={`w-full text-left pl-3 pr-8 py-2 rounded-md transition-colors text-sm truncate ${currentConversationId === conv.id ? `${currentTheme.accent} ${currentTheme.accentText}` : currentTheme.hover}`}>{conv.title}</button>
                        <button onClick={() => deleteConversation(conv.id)} className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity ${currentConversationId === conv.id ? `hover:bg-blue-500` : `hover:bg-slate-600`}`}><Trash2 className="w-4 h-4"/></button>
                    </div>
                )) : <p className={`text-sm ml-3 ${currentTheme.subtleText}`}>Aucun agent.</p>}
            </div>
          </div>
        </div>
        {/* Section Utilisateur/Profil/Déconnexion */}
        <div className={`p-4 border-t ${currentTheme.border} flex flex-col space-y-2 sticky bottom-0 ${currentTheme.card}`}>
          {/* Affiche le nom d'affichage de l'utilisateur ou 'Utilisateur Anonyme' */}
          <button onClick={() => setIsSettings(true)} className={`w-full text-left p-2 rounded-md ${currentTheme.hover} transition-colors flex items-center space-x-2`}>
            <User className="w-5 h-5" />
            <span className="truncate" title={userProfile?.displayName || `ID: ${userId}`}>{userProfile?.displayName || "Utilisateur Anonyme"}</span>
          </button>
          <button onClick={handleLogout} className={`w-full text-left p-2 rounded-md ${currentTheme.hover} transition-colors flex items-center space-x-2 text-red-400 hover:text-red-500`}>
            <LogOut className="w-5 h-5" />
            <span>Déconnexion</span>
          </button>
        </div>
      </aside>

      {/* Zone Principale du Chat */}
      <div className="flex-1 flex flex-col w-full">
        {/* En-tête du Chat */}
        <header className={`${currentTheme.bg} p-4 pb-2 sticky top-0 z-30`}> {/* Outer header provides padding */}
            <div className={`max-w-4xl mx-auto flex items-center justify-between border ${currentTheme.border} rounded-xl ${currentTheme.card} h-14 px-3`}>
                {/* Left group of header components */}
                <div className="flex items-center space-x-3">
                    {/* Bouton Ouvrir l'historique (mobile uniquement) */}
                    <button onClick={() => setIsHistoryOpen(true)} className={`p-2 rounded-md ${currentTheme.hover} transition-colors lg:hidden`}>
                    <History className="w-5 h-5" />
                    </button>
                    {/* Menu déroulant de sélection du modèle */}
                    <div className="relative">
                    <button onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)} className={`${currentTheme.card} border ${currentTheme.border} px-3 py-1.5 rounded-md text-sm flex items-center space-x-2 ${currentTheme.hover} transition-colors`}>
                        <Cpu className="w-4 h-4" />
                        <span className="max-w-32 truncate hidden md:block">{Object.values(allAvailableModels).flat().find(m => m.id === selectedModel)?.name || 'Sélectionner un modèle'}</span>
                        <ChevronDown className="w-4 h-4" />
                    </button>
                    {isModelDropdownOpen && (
                        <div className={`absolute top-full mt-2 ${currentTheme.card} border ${currentTheme.border} rounded-lg shadow-xl z-50 min-w-64 backdrop-blur-md bg-opacity-80`}>
                        {Object.entries(allAvailableModels).map(([category, categoryModels]) => (
                            // Only render category if it has models. Don't render 'custom' category if empty.
                            categoryModels.length > 0 && (
                            <div key={category} className="p-2">
                                <div className={`text-xs font-semibold ${currentTheme.subtleText} uppercase tracking-wider mb-1 px-3`}>{category === 'custom' ? 'Modèles Personnalisés' : category}</div>
                                {categoryModels.map(model => (
                                <button key={model.id} onClick={() => { setSelectedModel(model.id); setIsModelDropdownOpen(false); }} className={`w-full text-left px-3 py-2 rounded-md ${currentTheme.hover} transition-colors flex items-center justify-between ${selectedModel === model.id ? 'bg-blue-600/10 text-blue-400' : ''}`}>
                                    <span className="text-sm">{model.name}</span>
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                                    model.type === 'OpenAI' ? 'bg-purple-500/20 text-purple-400' :
                                    model.type === 'Google' ? 'bg-indigo-500/20 text-indigo-400' :
                                    model.type === 'Anthropic' ? 'bg-orange-500/20 text-orange-400' :
                                    model.type === 'Custom' ? 'bg-green-500/20 text-green-400' :
                                    'bg-slate-500/20 text-slate-400' // Simulated
                                    }`}>{model.type}</span>
                                </button>
                                ))}
                            </div>
                            )
                        ))}
                        <div className="p-2 border-t mt-2 border-slate-700">
                            <button onClick={() => { setIsCustomModelsManagerOpen(true); setIsModelDropdownOpen(false); }} className={`w-full text-left px-3 py-2 rounded-md ${currentTheme.hover} transition-colors flex items-center space-x-2`}>
                                <Plus className="w-4 h-4" />
                                <span>Gérer les Modèles Personnalisés</span>
                            </button>
                        </div>
                        </div>
                    )}
                    </div>
                    {/* Indicateur de prompt système actif / agent actif */}
                    {activeAgent ? (
                    <div className={`text-xs px-2 py-1 rounded-full ${currentTheme.accent} ${currentTheme.accentText} bg-opacity-20 flex items-center space-x-1`}>
                        <Users className="w-3 h-3"/>
                        <span>Agent: {activeAgent.name}</span>
                        <button onClick={() => handleSelectActiveAgent(null)} className="ml-1 text-white/70 hover:text-white"><X className="w-3 h-3"/></button>
                    </div>
                    ) : currentSystemPrompt ? (
                    <div className={`text-xs px-2 py-1 rounded-full ${currentTheme.accent} ${currentTheme.accentText} bg-opacity-20 flex items-center space-x-1`}>
                        <Brain className="w-3 h-3"/>
                        <span>Contexte Actif: {currentSystemPrompt.substring(0, 30)}...</span> {/* Show a snippet of the active context */}
                        <button onClick={() => setSystemPromptForCurrentConversation(null)} className="ml-1 text-white/70 hover:text-white"><X className="w-3 h-3"/></button>
                    </div>
                    ) : null}
                </div>
                {/* Indicateur de serveurs MCP dans le coin droit */}
                <MCPServerStatusIndicator mcpServers={mcpServers} theme={currentTheme} />
            </div>
        </header>

        {/* Zone des Messages du Chat */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {/* Message de bienvenue ou historique du chat */}
            {currentChatHistory.length === 0 && !isChatLoading ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                    <div className={`w-24 h-24 relative flex items-center justify-center mb-6 rounded-3xl ${currentTheme.glow}`}>
                        <img src={currentTheme.logoUrl} alt="FleetCrew AI Logo" className="w-full h-full object-contain rounded-3xl" />
                    </div>
                    <h2 className="text-4xl font-extrabold mb-2" style={{fontFamily: 'Inter, sans-serif'}}>
                      <span style={{color: '#FFFFFF'}}>FleetCrew</span>
                      <span style={{color: '#00e6e6'}}> AI</span>
                    </h2>
                    <p className={`${currentTheme.subtleText} max-w-md`}>Cliquez sur <code className="bg-slate-700 text-slate-300 px-1 py-0.5 rounded">+</code> pour gérer les prompts ou commencez à taper.</p>
                </div>
            ) : (
              currentChatHistory.map((msg) => (
                <div key={msg.id} className={`flex gap-3 items-start ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {/* Avatar/Icône IA */}
                  {msg.sender === 'ai' && <div className={`w-8 h-8 ${msg.isError ? 'bg-red-500/20' : 'bg-slate-700'} rounded-full flex items-center justify-center shrink-0`}><Sparkles className={`w-4 h-4 ${msg.isError ? 'text-red-500' : 'text-slate-400'}`}/></div>}
                  {/* Bulle de message */}
                  <div className={`max-w-xs sm:max-w-md lg:max-w-lg xl:max-w-2xl px-4 py-3 rounded-xl ${msg.sender === 'user' ? `${currentTheme.accent} ${currentTheme.accentText}` : `${currentTheme.card} border ${msg.isError ? 'border-red-500/50' : currentTheme.border}`}`}>
                    {/* Rend le texte du message, en remplaçant les nouvelles lignes, les espaces réservés aux images et les blocs de code */}
                    <div className="prose prose-sm prose-invert text-white" dangerouslySetInnerHTML={{__html: msg.text.replace(/\n/g, '<br />').replace(/\[Image d'un(.*?)\]/g, `<div class='p-4 border border-dashed border-slate-600 rounded-lg text-center my-2'><p class='text-slate-400'>🖼️ [Image d'un $1]</p></div>`).replace(/```([\s\S]*?)```/g, `<pre class='bg-slate-900/70 p-3 rounded-lg my-2'><code class='text-sm'>$1</code></pre>`) }}></div>
                    <div className={`text-xs mt-2 ${msg.sender === 'user' ? 'text-blue-200' : currentTheme.subtleText}`}>{msg.timestamp}</div>
                  </div>
                </div>
              ))
            )}
            {/* Indicateur de chargement */}
            {isChatLoading && (
              <div className="flex gap-3 items-start justify-start">
                <div className="w-8 h-8 bg-slate-700 rounded-full flex items-center justify-center shrink-0"><Loader2 className="w-4 h-4 text-slate-400 animate-spin"/></div>
                <div className={`max-w-xs sm:max-w-md px-4 py-3 rounded-xl ${currentTheme.card} border ${currentTheme.border}`}><div className="flex items-center space-x-2"><div className="w-2 h-2 bg-slate-500 rounded-full animate-pulse"></div><div className="w-2 h-2 bg-slate-500 rounded-full animate-pulse delay-75"></div><div className="w-2 h-2 bg-slate-500 rounded-full animate-pulse delay-150"></div></div></div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Zone de Saisie */}
          <div className={`${currentTheme.bg} p-4`}>
            {/* Amorces de Conversation empilées, disparaissent à l'envoi */}
            {showConversationStarters && currentChatHistory.length === 0 && (
              <div className="max-w-4xl mx-auto mb-4 flex flex-col items-center space-y-2">
                {pyramidConversationStarters.map((row, rowIndex) => (
                  <div key={rowIndex} className="flex justify-center gap-2 w-full">
                    {row.map((starter, starterIndex) => (
                      <button
                        key={`${rowIndex}-${starterIndex}`}
                        onClick={() => handleSelectPrompt(starter)}
                        className={`px-4 py-2 rounded-full text-sm ${currentTheme.hover} border ${currentTheme.border} ${currentTheme.subtleText} flex-shrink-0 whitespace-nowrap`}
                        // Adjust maxWidth based on row index for pyramid effect
                        style={{ maxWidth: rowIndex === 0 ? '40%' : rowIndex === 1 ? '60%' : '80%' }}
                      >
                        {starter}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}

            <div className="max-w-4xl mx-auto">
              <div className={`relative flex items-end border ${currentTheme.border} rounded-xl ${currentTheme.card} p-1.5`}>
                {/* Left group of input components */}
                <div className="flex items-center space-x-0.5">
                    {/* Bouton du gestionnaire de prompts */}
                    <button onClick={() => setIsPromptManagerOpen(true)} className={`p-1.5 ${currentTheme.hover} rounded-md`} title="Gérer les prompts système et de discussion">
                    <PlusCircle className="w-5 h-5" />
                    </button>

                    {/* Nouveau bouton pour ouvrir le gestionnaire de contextes (pastilles) */}
                    <button onClick={() => setIsContextPillsManagerOpen(true)} className={`p-1.5 ${currentTheme.hover} rounded-md`} title="Gérer les contextes prédéfinis (pastilles)">
                        <LayoutGrid className="w-5 h-5" />
                    </button>

                    {/* Bouton Trombone / Menu Déroulant */}
                    <div className="relative">
                    <button onClick={() => setIsPaperclipDropdownOpen(prev => !prev)} className={`p-1.5 ${currentTheme.hover} rounded-md`} title="Attacher un fichier ou une image">
                        <Paperclip className="w-5 h-5" />
                    </button>
                    {isPaperclipDropdownOpen && (
                        <div className={`absolute bottom-full mb-2 left-0 p-2 rounded-lg shadow-xl z-50 min-w-48 backdrop-blur-md ${currentTheme.card} bg-opacity-80 border ${currentTheme.border}`}>
                        <button onClick={() => { fileInputRef.current?.click(); setIsPaperclipDropdownOpen(false); }} className={`w-full text-left px-3 py-2 rounded-md ${currentTheme.hover} transition-colors flex items-center space-x-2`}>
                            <Paperclip className="w-4 h-4" />
                            <span>Attacher un fichier</span>
                            <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                        </button>
                        <button onClick={() => { imageInputRef.current?.click(); setIsPaperclipDropdownOpen(false); }} className={`w-full text-left px-3 py-2 rounded-md ${currentTheme.hover} transition-colors flex items-center space-x-2 mt-1`}>
                            <ImageIcon className="w-4 h-4" />
                            <span>Uploader/Prendre Photo</span>
                            <input type="file" accept="image/*" capture="environment" ref={imageInputRef} onChange={handleImageChange} className="hidden" />
                        </button>
                        </div>
                    )}
                    </div>

                    <button onClick={handleMicToggle} className={`p-1.5 ${isMicActive ? 'text-red-500' : ''} ${currentTheme.hover} rounded-md`} title={isMicActive ? "Désactiver le microphone" : "Activer le microphone"}>
                    <Mic className="w-5 h-5" />
                    </button>
                </div>

                {/* Zone de texte de saisie du message */}
                <textarea
                  ref={inputRef}
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  onKeyPress={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                  placeholder="Tapez votre message ou cliquez sur + pour utiliser un prompt..."
                  className="flex-1 w-full bg-transparent px-3 py-2 focus:outline-none resize-none overflow-hidden"
                  rows="1"
                  style={{minHeight: '52px'}}
                  disabled={isChatLoading}
                />
                {/* Bouton d'envoi du message */}
                <div className="p-1">
                  <button onClick={handleSendMessage} disabled={!message.trim() || isChatLoading} className={`p-2 ${currentTheme.accent} ${currentTheme.accentText} rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0`}>
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Modal des Paramètres */}
      {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60" onClick={() => setIsSettings(false)} />
            <div className={`${currentTheme.card} border ${currentTheme.border} rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col relative`}>
              <div className={`p-6 border-b ${currentTheme.border} flex items-center justify-between sticky top-0 bg-inherit rounded-t-2xl`}>
                <h3 className="text-xl font-semibold">Paramètres</h3>
                <button onClick={() => setIsSettings(false)}> <X className="w-6 h-6" /></button>
              </div>
              <div className="p-6 space-y-8 overflow-y-auto">
                {/* Section Mon Profil */}
                <div>
                  <h4 className={`font-semibold mb-4 flex items-center space-x-2 ${currentTheme.subtleText}`}> <User className="w-5 h-5 text-purple-400" /> <span>Mon Profil</span> </h4>
                  <div className="space-y-3">
                    <div>
                      <label htmlFor="displayName" className={`block text-sm font-medium mb-1 ${currentTheme.text}`}>Nom d'affichage</label>
                      <input
                        type="text"
                        id="displayName"
                        value={newDisplayName}
                        onChange={(e) => setNewDisplayName(e.target.value)}
                        placeholder="Votre nom ou pseudonyme"
                        className={`w-full bg-transparent border ${currentTheme.border} rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500`}
                      />
                    </div>
                    {/* OpenAI API Key & Base URL */}
                    <div>
                      <label htmlFor="openaiApiKey" className={`block text-sm font-medium mb-1 ${currentTheme.text}`}>Clé API OpenAI</label>
                      <input
                        type="password"
                        id="openaiApiKey"
                        value={openaiApiKey}
                        onChange={(e) => setOpenaiApiKey(e.target.value)}
                        placeholder="sk-YOUR_OPENAI_API_KEY"
                        className={`w-full bg-transparent border ${currentTheme.border} rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500`}
                      />
                    </div>
                    <div>
                      <label htmlFor="openaiBaseUrl" className={`block text-sm font-medium mb-1 ${currentTheme.text}`}>URL de Base OpenAI (optionnel)</label>
                      <input
                        type="text"
                        id="openaiBaseUrl"
                        value={openaiBaseUrl}
                        onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                        placeholder="https://api.openai.com (par défaut)"
                        className={`w-full bg-transparent border ${currentTheme.border} rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500`}
                      />
                    </div>
                    {/* Anthropic API Key & Base URL */}
                    <div>
                      <label htmlFor="anthropicApiKey" className={`block text-sm font-medium mb-1 ${currentTheme.text}`}>Clé API Anthropic</label>
                      <input
                        type="password"
                        id="anthropicApiKey"
                        value={anthropicApiKey}
                        onChange={(e) => setAnthropicApiKey(e.target.value)}
                        placeholder="sk-ant-api03-YOUR_ANTHROPIC_API_KEY"
                        className={`w-full bg-transparent border ${currentTheme.border} rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500`}
                      />
                    </div>
                    <div>
                      <label htmlFor="anthropicBaseUrl" className={`block text-sm font-medium mb-1 ${currentTheme.text}`}>URL de Base Anthropic (optionnel)</label>
                      <input
                        type="text"
                        id="anthropicBaseUrl"
                        value={anthropicBaseUrl}
                        onChange={(e) => setAnthropicBaseUrl(e.target.value)}
                        placeholder="https://api.anthropic.com/v1 (par défaut)"
                        className={`w-full bg-transparent border ${currentTheme.border} rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500`}
                      />
                    </div>
                    <button onClick={handleSaveProfile} className={`px-4 py-2 text-sm font-semibold rounded-md ${currentTheme.accent} ${currentTheme.accentText} hover:bg-blue-700 transition-colors`}>
                      Sauvegarder le profil
                    </button>
                  </div>
                </div>

                {/* Section Crédits de Pouvoir */}
                <div>
                  <h4 className={`font-semibold mb-4 flex items-center space-x-2 ${currentTheme.subtleText}`}> <Zap className="w-5 h-5 text-yellow-400" /> <span>Crédits de Pouvoirs</span> </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {powers.map(power => ( <div key={power.id} className={`${currentTheme.card} border ${currentTheme.border} rounded-lg p-4`}> <div className="flex items-center justify-between mb-2"> <div className="flex items-center space-x-2"> <power.icon className={`w-5 h-5 ${power.color}`} /> <span className="font-medium">{power.name}</span> </div> <span className="font-mono text-lg">{power.count}</span> </div> </div> ))}
                  </div>
                </div>
                {/* Section Connecteurs MCP */}
                <div>
                  <h4 className={`font-semibold mb-4 flex items-center space-x-2 ${currentTheme.subtleText}`}> <Network className="w-5 h-5 text-blue-400" /> <span>Connecteurs MCP</span> </h4>
                  <div className="space-y-3">
                    {connectors.map(connector => ( <div key={connector.id} className={`${currentTheme.card} border ${currentTheme.border} rounded-lg p-4 flex items-center justify-between`}> <div className="flex items-center space-x-3"> <connector.icon className="w-5 h-5" /> <span className="font-medium">{connector.name}</span> </div>
                      <button onClick={() => setActiveConnectors(prev => prev.includes(connector.id) ? prev.filter(id => id !== connector.id) : [...prev, connector.id])} className={`w-12 h-6 rounded-full transition-colors flex items-center p-0.5 ${ activeConnectors.includes(connector.id) ? 'bg-blue-600' : darkMode ? 'bg-slate-600' : 'bg-slate-300' }`}>
                        <div className={`w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${ activeConnectors.includes(connector.id) ? 'translate-x-6' : 'translate-x-0' }`} />
                      </button> </div> ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
      )}
    </div>
  );
};

// Enveloppe l'application principale avec l'ErrorBoundary
const AppWithErrorBoundary = () => (
    <ErrorBoundary>
        <MCPChatClient />
    </ErrorBoundary>
);

export default AppWithErrorBoundary;
