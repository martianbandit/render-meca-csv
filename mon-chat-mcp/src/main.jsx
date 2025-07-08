import React from 'react'
import ReactDOM from 'react-dom/client'
import AppWithErrorBoundary from './App.jsx' // Assurez-vous que c'est le bon nom de fichier et d'export
import './index.css' // Si vous avez un fichier CSS global

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppWithErrorBoundary />
  </React.StrictMode>,
)
