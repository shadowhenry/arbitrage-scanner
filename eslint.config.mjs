import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/apps/api/public/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      globals: {
        HTMLDivElement: 'readonly',
        ResizeObserver: 'readonly',
        location: 'readonly',
        window: 'readonly',
      },
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] },
    },
  },
);
