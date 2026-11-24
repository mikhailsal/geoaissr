# Bot prompts

The start prompt of every bot lives here as a plain text file, so it can be tuned without touching
code.

| File                  | Who reads it                                                                 |
| --------------------- | ---------------------------------------------------------------------------- |
| `intuit.txt`          | A bot that plays the Intuit style: one process sees the frames and guesses.  |
| `detective-brain.txt` | The brain of a Detective bot: it reads text only, asks the eyes and guesses. |
| `detective-eyes.txt`  | The eyes of a Detective bot: they see the frames and describe them.          |

The prompts are written in Russian, like everything else a bot or a player reads.

## Editing

A file is read every time a bot is launched. Save the file and the change applies from the next
round; the server does not need a restart.

The text is sent to the model as it is written, line breaks included. Three kinds of tags are
replaced first:

| Tag                             | Meaning                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `{{name}}`                      | The value of a variable, for example `{{budgetSec}}`.              |
| `{{#if flag}}…{{else}}…{{/if}}` | The first part when the flag is true, the second when it is false. |
| `{{! any text }}`               | A comment for whoever edits the file. It never reaches the model.  |

`{{else}}` is optional. Blocks may sit inside other blocks. A block tag alone on its line takes the
whole line with it, so a block leaves no blank line behind.

The comment at the top of each file lists the variables and flags that file may use. No other
names exist: a new variable needs a line of code in `server/bots/prompt.ts` (Intuit) or
`server/bots/detective/prompts.ts` (Detective).

## When a file is broken

An unknown variable, a tag that is not closed or a missing file stops the bot from launching. Every
name in the file is checked, also inside a block that the current settings do not show. The
bot shows up as failed in the round, and the host's diagnostics name the file and the problem, for
example `Prompt template detective-brain.txt: unknown variable {{budgetSecs}}`. Nothing is sent to
a model in that case. Fix the file and the next round picks it up.

`bun run test` renders every file for every setting, so a broken tag also fails the test suite.

## What is not in these files

- **Tool descriptions** (the text a model reads next to each tool and each argument) live with the
  tool schemas in `shared/bot-tools.ts` and `shared/detective-tools.ts`.
- **Replies of the tools** (for example the text that comes back with a frame, or the reminder
  about the control check) live in `server/bots/` and `server/bots/detective/`.
- **The vision check prompt** («Проверить зрение») lives in `server/bots/prompt.ts`: it must match
  the checker, so it is not meant for tuning.

## Rules the Detective prompts depend on

The server enforces a few rules whatever the prompt says, and the prompts describe them to the
models. Keep the text and the rules in step:

- The brain never receives an image. Its requests name a topic to look at; a request with `?` or
  the particle «ли», or one that names a country, a city or a people, is refused.
- The eyes never name a place. Place words in their own words are replaced with `[…]` before the
  brain reads them; text copied from a frame inside «…» is kept as it is.
- The report has seven sections with fixed keys (`texts`, `road`, `vehicles`, `poles_signs`,
  `buildings`, `nature`, `unusual`). The lines «Сторона движения:», «Дорога идёт:» and «Солнце:»
  are a convention between the two prompts only: both files name them, so change them together.
- The eyes may spend at most three paid actions before the report, and every ask of the brain
  waits up to 30 seconds for the answer (45 with a drive).
- On `agy` the eyes receive frames as files in their work directory and must open them with
  `read_file` (the `fileDelivery` flag of `detective-eyes.txt`). The file guard lets the eyes read
  only that directory and the brain no file at all, whatever the prompt says.
