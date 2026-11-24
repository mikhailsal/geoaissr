import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Bot prompts live in plain text files under `server/bots/prompts/`, so they can be tuned without
 * touching code. A file is read every time a bot is launched: an edit applies from the next round,
 * with no server restart.
 *
 * Template syntax (see `server/bots/prompts/README.md`):
 *   {{name}}                         the value of a variable
 *   {{#if flag}}…{{else}}…{{/if}}    a block shown when the flag is true; `{{else}}` is optional
 *   {{! any text }}                  a comment, left out of the prompt
 * Blocks may nest. An unknown variable or a broken tag fails the launch with a message that names
 * the file, so a typo never reaches a model silently. Every name in the file is checked, also the
 * ones inside a block this round does not show.
 */

export const PROMPTS_DIR = path.resolve(import.meta.dir, 'prompts');

export type PromptValues = Readonly<Record<string, string | number | boolean>>;

export class PromptTemplateError extends Error {
  constructor(file: string, problem: string) {
    super(`Prompt template ${file}: ${problem}`);
    this.name = 'PromptTemplateError';
  }
}

const COMMENT = /\{\{![\s\S]*?\}\}[ \t]*\n?/g;
/** A block tag alone on its line takes the whole line, so blocks leave no blank lines behind. */
const STANDALONE_TAG = /^[ \t]*(\{\{(?:#if \w+|else|\/if)\}\})[ \t]*\n/gm;
/** An innermost block: its body holds no other `{{#if`. Outer blocks resolve on later passes. */
const BLOCK = /\{\{#if (\w+)\}\}((?:(?!\{\{#if )[\s\S])*?)\{\{\/if\}\}/g;
const MAX_NESTING = 8;
const VARIABLE = /\{\{(\w+)\}\}/g;
/** Every name a tag refers to: `{{name}}` and `{{#if name}}`. */
const REFERENCE = /\{\{(?:#if )?(\w+)\}\}/g;
/** Any `{{` still there after the blocks and variables are gone. A lone `}}` is plain text. */
const LEFTOVER = /\{\{[^}]*(?:\}\})?/;

function lookup(file: string, values: PromptValues, name: string): string | number | boolean {
  // Own names only: `{{toString}}` is a typo, not the function every object inherits.
  const value = Object.hasOwn(values, name) ? values[name] : undefined;
  if (value === undefined) throw new PromptTemplateError(file, `unknown variable {{${name}}}`);
  return value;
}

/** A name in a block that is dropped would otherwise never be looked up. */
function checkReferences(file: string, values: PromptValues, source: string): void {
  for (const [, name = ''] of source.matchAll(REFERENCE)) {
    if (name !== 'else') lookup(file, values, name);
  }
}

export function renderPromptTemplate(
  template: string,
  values: PromptValues,
  file = 'template',
): string {
  const source = template.replace(/\r\n/g, '\n').replace(COMMENT, '').replace(STANDALONE_TAG, '$1');
  checkReferences(file, values, source);
  let withBlocks = source;
  for (let depth = 0; depth < MAX_NESTING && withBlocks.includes('{{#if '); depth += 1) {
    withBlocks = withBlocks.replace(BLOCK, (_match, flag: string, body: string) => {
      const [whenTrue = '', whenFalse = '', ...extra] = body.split('{{else}}');
      if (extra.length > 0) throw new PromptTemplateError(file, `{{#if ${flag}}} has two {{else}}`);
      return lookup(file, values, flag) ? whenTrue : whenFalse;
    });
  }
  // Checked before the values go in: a bot name with braces in it is not a broken tag.
  const leftover = LEFTOVER.exec(withBlocks.replace(VARIABLE, ''));
  if (leftover) throw new PromptTemplateError(file, `broken tag near "${leftover[0]}"`);
  return withBlocks
    .replace(VARIABLE, (_match, name: string) => String(lookup(file, values, name)))
    .trim();
}

/** Reads `file` from the prompts directory and fills it in. */
export function loadPrompt(file: string, values: PromptValues, dir = PROMPTS_DIR): string {
  let template: string;
  try {
    template = readFileSync(path.join(dir, file), 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new PromptTemplateError(file, `cannot read the file (${reason})`);
  }
  return renderPromptTemplate(template, values, file);
}
