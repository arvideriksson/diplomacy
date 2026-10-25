<script lang="ts">
  // Round user avatar: the name's initial on a disc whose hue is derived from the name,
  // so each player keeps a stable colour. Profile pictures are deliberately not shown.
  /** Name (or email) whose first letter is the initial and whose hash picks the colour. */
  export let name: string | null | undefined = null
  export let size = 32

  $: initial = name?.trim()[0]?.toUpperCase() ?? '?'
  $: hue = hashHue(name ?? '')

  function hashHue(s: string): number {
    let h = 0
    for (const ch of s) h = (h * 31 + ch.codePointAt(0)!) >>> 0
    return h % 360
  }
</script>

<div
  class="avatar"
  style:width="{size}px"
  style:height="{size}px"
  style:font-size="{Math.round(size * 0.42)}px"
  style:background="hsl({hue} 55% 45%)"
>{initial}</div>

<style>
  .avatar {
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: #fff;
    font-weight: 600;
    user-select: none;
  }
</style>
