<script lang="ts">
  import { RU } from '../i18n/ru';
</script>

<!-- Marks a player in a list who has pressed «Готов». -->
<span class="ready-mark">✓ {RU.results.readyMark}</span>

<style>
  .ready-mark {
    display: inline-block;
    margin-left: var(--sp-1);
    padding: 0 var(--sp-1);
    border: 1px solid var(--ok);
    border-radius: var(--radius-sm);
    color: var(--ok);
    font-size: 0.74rem;
    font-weight: 700;
    white-space: nowrap;
  }
</style>
