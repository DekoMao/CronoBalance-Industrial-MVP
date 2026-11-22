import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base:process.env.VITE_BASE_PATH||'/',plugins:[react()],
  build:{assetsInlineLimit:100000,rollupOptions:{output:{inlineDynamicImports:true}},chunkSizeWarningLimit:1400}
});
