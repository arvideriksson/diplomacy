<script lang="ts">
  // The bordered card the sidebar's order and to-do lists sit in; each slotted <li> is
  // one row, divided by a hairline.
</script>

<ul class="orders"><slot /></ul>

<style>
  .orders {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-card);
    overflow: hidden;
  }
  .orders > :global(li) {
    display: flex;
    align-items: center;
    min-height: 40px;
    padding-left: 12px;
    font-variant-numeric: tabular-nums;
  }
  .orders > :global(li + li) {
    border-top: 1px solid var(--border);
  }
</style>
