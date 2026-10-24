<script lang="ts">
  // Round user avatar: the profile image when there is one, else the name's initial on
  // an accent disc.
  export let src: string | null | undefined = null
  /** Name (or email) whose first letter is the fallback initial. */
  export let name: string | null | undefined = null
  export let size = 32

  $: initial = name?.[0]?.toUpperCase() ?? '?'
</script>

{#if src}
  <img {src} alt="" class="avatar" style:width="{size}px" style:height="{size}px" />
{:else}
  <div class="avatar placeholder" style:width="{size}px" style:height="{size}px">{initial}</div>
{/if}

<style>
  .avatar {
    border-radius: 50%;
    object-fit: cover;
    display: block;
    flex-shrink: 0;
  }

  .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: var(--text-inverse);
    font-weight: 600;
    font-size: 13px;
  }
</style>
