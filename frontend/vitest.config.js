import { mergeConfig } from 'vite';
import viteConfig from './vite.config.js';

export default mergeConfig(viteConfig, {
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    css: false,
    restoreMocks: true,
    testTimeout: 20000
  }
});
