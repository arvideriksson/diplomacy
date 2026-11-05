<script lang="ts">
  // The Congress of Berlin (Anton von Werner, 1881; public domain) filling the space
  // either side of the 960px content column on the home screen and the lobby. One
  // image, cropped left and right. Fixed, so it stays put while the page scrolls;
  // hidden once the margins get too narrow to carry it.
</script>

<div class="art-columns" aria-hidden="true">
  <div class="art left"><img src="/art/congress-of-berlin.webp" alt="" decoding="async" fetchpriority="low" /></div>
  <div class="art right"><img src="/art/congress-of-berlin.webp" alt="" decoding="async" fetchpriority="low" /></div>
</div>

<style>
  .art-columns {
    display: none;
  }
  /* Margins of at least 120px each: App's main is 960px wide. */
  @media (min-width: 1200px) {
    .art-columns {
      display: block;
    }
  }
  .art {
    position: fixed;
    top: 0;
    bottom: 0;
    width: calc((100vw - 960px) / 2);
    overflow: hidden;
    pointer-events: none;
    z-index: 0;
  }
  .left {
    left: 0;
  }
  .right {
    right: 0;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .left img {
    object-position: 22% 50%;
  }
  .right img {
    object-position: 78% 50%;
  }
  /* A short fade into the page colour, so cards never butt against the painting. */
  .art::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 28px;
  }
  .left::after {
    right: 0;
    background: linear-gradient(90deg, transparent, var(--bg));
  }
  .right::after {
    left: 0;
    background: linear-gradient(270deg, transparent, var(--bg));
  }
  @media (prefers-color-scheme: dark) {
    img {
      filter: brightness(0.8);
    }
  }
</style>
