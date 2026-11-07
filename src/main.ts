import { mount } from 'svelte'
import '@fontsource-variable/ibm-plex-sans'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource/ibm-plex-mono/700.css'
import './app.css'
import App from './App.svelte'
import { keepAppUpdated } from './lib/pwaUpdate'

keepAppUpdated()

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
