import { defineConfig } from 'vite';

export default defineConfig({
  // publicDir: 'public', // default
  server: {
    host: true // Enable network access for testing AR on mobile
  }
});
