<script lang="ts">
  // On/off switch. Controlled: shows `checked` and reports the user's flip via onChange.
  export let checked = false
  export let disabled = false
  /** Accessible name when the switch has no visible label of its own. */
  export let label = ''
  export let onChange: (checked: boolean) => void = () => {}
</script>

<label class="toggle">
  <input
    type="checkbox"
    {checked}
    {disabled}
    aria-label={label || undefined}
    on:change={(e) => onChange(e.currentTarget.checked)}
  />
  <span class="toggle-track"><span class="toggle-thumb"></span></span>
</label>

<style>
  .toggle {
    flex-shrink: 0;
    cursor: pointer;
  }

  .toggle input {
    display: none;
  }

  .toggle-track {
    display: block;
    width: 40px;
    height: 22px;
    background: var(--border-strong);
    border-radius: var(--radius-full);
    position: relative;
    transition: background 0.2s;
  }

  .toggle input:checked + .toggle-track {
    background: var(--accent);
  }

  .toggle input:disabled + .toggle-track {
    opacity: 0.5;
    cursor: default;
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    background: white;
    border-radius: 50%;
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  }

  .toggle input:checked + .toggle-track .toggle-thumb {
    transform: translateX(18px);
  }
</style>
