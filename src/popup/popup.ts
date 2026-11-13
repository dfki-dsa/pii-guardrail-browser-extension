import { mount } from 'svelte';
import '../shared/styles/tokens.css';
import '../shared/styles/info-tag.css';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) {
  throw new Error('Popup mount target #app not found');
}

mount(App, { target });
