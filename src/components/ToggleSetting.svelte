<script lang="ts">
  // A settings row: label (with an optional ⓘ tip) on the left, a Toggle on the right.
  import InfoTip from './InfoTip.svelte'
  import Toggle from './Toggle.svelte'

  export let label: string
  /** Explanation shown in the ⓘ bubble; omitted when empty. */
  export let tip = ''
  export let checked = false
  export let disabled = false
  export let onChange: (checked: boolean) => void = () => {}
</script>

<div class="setting-group toggle-row">
  <span class="setting-label">{label}{#if tip}<InfoTip text={tip} />{/if}</span>
  <Toggle {checked} {disabled} {label} {onChange} />
</div>

<style>
  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
</style>
