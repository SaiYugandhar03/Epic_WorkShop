import React from 'react'
import ReactDOM from 'react-dom/client'
import '@siemens/ix/dist/siemens-ix/siemens-ix.css'
import '@siemens/ix/dist/siemens-ix/theme/classic-light.css'
import '@siemens/ix/dist/siemens-ix/theme/classic-dark.css'
import { addIcons } from '@siemens/ix-icons'
import {
  iconReset,
  iconSaveAll,
  iconFolderOpen,
  iconRocket,
  iconCopy,
  iconDownload,
} from '@siemens/ix-icons/icons'
import App from './App'
import './styles.css'

addIcons({
  reset: iconReset,
  'save-all': iconSaveAll,
  'folder-open': iconFolderOpen,
  rocket: iconRocket,
  copy: iconCopy,
  download: iconDownload,
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
