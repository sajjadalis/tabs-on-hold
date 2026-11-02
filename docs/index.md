---
layout: home
title: Tabs on Hold
titleTemplate: false
hero:
  name: Tabs on Hold
  text: Room for what’s next.
  tagline: Save and organize tabs with screenshot previews and easy restore.
  image:
    src: /logo.svg
    alt: Tabs on Hold
  actions:
    - theme: brand
      text: Add to Chrome
      link: https://chromewebstore.google.com/detail/tabs-on-hold/gaefdclihmlpcnnabebiaonmepdhfapb
    - theme: alt
      text: Get started
      link: /guide
    - theme: alt
      text: View on GitHub
      link: https://github.com/sajjadalis/tabs-on-hold
features:
  - icon:
      src: /icons/save.svg
    title: Set tabs aside
    details: Save a tab, selected tabs, or whole windows. Make space without losing the pages you want to return to.
    link: /guide#save-your-tabs
    linkText: Save a session
  - icon:
      src: /icons/preview.svg
    title: See what you saved
    details: Recognize a page from its screenshot. Open a larger preview before deciding which website to revisit.
    link: /guide#preview-a-saved-page
    linkText: Explore previews
  - icon:
      src: /icons/organize.svg
    title: Give everything a place
    details: Name sessions, drag tabs between them, mark favorites, and search your library in card or list view.
    link: /guide#organize-your-library
    linkText: Organize your tabs
  - icon:
      src: /icons/restore.svg
    title: Pick up where you left off
    details: Restore one tab or an entire session. Keep the saved copy when you want to come back again.
    link: /guide#restore-your-tabs
    linkText: Restore a session
---

<script setup>
import { withBase } from 'vitepress';
</script>

<section class="home-section" id="library-preview" aria-labelledby="library-preview-title">
  <p class="eyebrow">A PLACE FOR YOUR OPEN LOOPS</p>
  <h2 id="library-preview-title">Your tabs, a little more together.</h2>
  <p class="section-intro">A project for later. A few things to read. Something that caught your eye. Keep them in named sessions, with a picture to help you remember.</p>
  <figure class="home-promo">
    <img :src="withBase('/images/tabs-on-hold-promo.png')" alt="Tabs on Hold: saved sessions, screenshot previews, and the library in light and dark appearance." width="1731" height="909" loading="lazy" />
  </figure>
</section>

<section class="home-section" aria-labelledby="how-it-works-title">
  <p class="eyebrow">FROM TOO MANY TABS TO A FRESH START</p>
  <h2 id="how-it-works-title">Save now. Come back when you’re ready.</h2>
  <div class="home-steps">
    <div class="home-step">
      <span class="home-step-number">01 / SET ASIDE</span>
      <h3>Clear some space.</h3>
      <p>Choose what to save from the toolbar. Tabs close after their data is saved. Website access is optional for screenshot previews.</p>
    </div>
    <div class="home-step">
      <span class="home-step-number">02 / MAKE IT YOURS</span>
      <h3>Keep a little order.</h3>
      <p>Give the session a name. Move a tab to another project, favorite a useful page, or find it again with search.</p>
    </div>
    <div class="home-step">
      <span class="home-step-number">03 / RETURN</span>
      <h3>Open what you need.</h3>
      <p>Preview a page, restore a single tab, or bring back the whole session. Export a backup when you want a copy of your library.</p>
    </div>
  </div>
</section>

<section class="home-section home-privacy" aria-labelledby="privacy-title">
  <div>
    <h2 id="privacy-title">A clear view of your data.</h2>
    <p>Your saved tabs and screenshots are stored on your computer and are not uploaded by the extension. You choose whether to grant website access for previews.</p>
  </div>
  <a href="./privacy">Read about privacy →</a>
</section>
