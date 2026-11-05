import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { keepAppUpdated } from './lib/pwaUpdate'

keepAppUpdated()

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
