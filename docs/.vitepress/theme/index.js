import DefaultTheme from 'vitepress/theme';
import { watch } from 'vue';
import './custom.css';
import './rainbow.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ router }) {
    if (typeof document === 'undefined') return;
    watch(
      () => router.route.data.frontmatter.layout,
      (layout) => document.documentElement.classList.toggle('rainbow', layout === 'home'),
      { immediate: true },
    );
  },
};
