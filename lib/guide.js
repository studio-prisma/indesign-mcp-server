/**
 * guide.js
 * What the server knows that its tool descriptions cannot say.
 *
 * A tool description is read when the model is already reaching for that tool.
 * It is the wrong place for the things you have to know *before* choosing one:
 * that indices run front to back, that geometry is millimetres while type is
 * points, that a property this InDesign version dropped aborts the whole call
 * rather than being ignored.
 *
 * MCP resources are the right place — a client can load one into the
 * conversation up front. Everything below was paid for in wasted afternoons,
 * which is the only reason it is worth writing down.
 */

export const GUIDE_URI = 'indesign://guide';
export const TOOLS_URI = 'indesign://tools';

export const RESOURCES = [
  {
    uri: GUIDE_URI,
    name: 'Working with InDesign through this server',
    description:
      'Read this first. The five things that otherwise cost an afternoon: ' +
      'index order, units, silent failures, undo, and what to do when a tool ' +
      'appears to do nothing.',
    mimeType: 'text/markdown',
  },
  {
    uri: TOOLS_URI,
    name: 'Tool index by task',
    description: 'Which tool for which job, grouped by what you are trying to do.',
    mimeType: 'text/markdown',
  },
];

export const GUIDE = `# Working with InDesign through this server

## Look before you build

\`inspect_page\` lists every object on a page with its type, position, size and
layer. \`check_layout\` reports what is wrong: text that overflows its frame,
frames with no artwork and no fill, objects past the page edge, overlapping
objects with the shared area.

Call one of them before changing an existing document, and again afterwards.
A tool reports what it did; only these report what the page looks like.

## Indices run front to back, and they shift

\`page.allPageItems\` and \`page.textFrames\` are ordered **front to back**:
index 0 is the most recently created object, not the first one on the page.
Verified against InDesign 21.5.

Indices also move whenever anything is added, deleted, grouped or restacked.
Read \`inspect_page\` again after any of those rather than reusing an index you
were given earlier.

For threading, pass \`readingOrder: true\` instead of listing frames by index.
Because the order is inverted, threading by ascending index runs the story
backwards up the page.

## Millimetres and points

Geometry — x, y, width, height, offsets — is in **millimetres**.
\`fontSize\` is in **points**, because that is what InDesign uses for type.

Nothing rejects a millimetre value passed as a font size: 10 is a valid point
size, so 10 mm of intended height silently becomes type a third that size. A
size below 4 pt comes back with a note. 1 mm is about 2.83 pt.

## A tool that seems to do nothing

InDesign does not ignore a property it does not have — it raises, and the
**whole call** aborts. One wrong name and a tool that does nine other things
correctly appears to do nothing at all.

When something misbehaves without explanation, run \`npm run verify-api\` in
the server directory. It checks every DOM property and enum member this server
writes against the running application.

Two more causes worth knowing:

- **A modal dialog** in InDesign blocks every scripted call until somebody
  dismisses it. The error arrives in the interface language.
- **Smart quotes.** InDesign replaces straight quotes in text you set, which
  matters when the exact characters are the point.

## Undo

Each tool call is one undo step, named after the tool. One \`undo\` reverses
one call completely, however many objects it touched, and the InDesign history
shows \`create_rectangle\` rather than its own label for the last internal
operation.

The \`undo\` tool steps back through the document's whole history, including
work done by hand in the interface. It is not a private stack.

## New frames have no stroke

Objects created by this server get no stroke unless you name a \`strokeColor\`.
InDesign's own default is 1 pt black, which is invisible on a dark ground and
draws a box around the element on a light one. If you want a stroke, ask for
one.

## Reaching what the tools do not wrap

The DOM has thousands of properties; a tool for each would be worse, not
better. \`inspect_object\`, \`set_properties\` and \`call_method\` reach all of
them.

\`\`\`json
{ "target": { "kind": "pageItem", "objectIndex": 2 },
  "properties": { "nonprinting": true,
                  "transparencySettings.blendingSettings.knockoutGroup": true } }
\`\`\`

\`inspect_object\` without a property list enumerates everything an object
offers, so you can find out what is available without documentation. Values
are numbers, strings, booleans and arrays, plus
\`{ enum: "Justification.CENTER_ALIGN" }\`, \`{ swatch: "Black" }\` and
\`{ measure: 20, unit: "mm" }\`. Each assignment is guarded on its own, so a
property this version lacks is reported without taking the others down.

**GREP search and replace** has no tool of its own but is reachable this way:
set \`findGrepPreferences.findWhat\` and \`changeGrepPreferences.changeTo\` with
\`set_properties\` on \`{ "kind": "application" }\`, then \`call_method\`
\`changeGrep\` on the document. Reset both preference objects afterwards — they
persist across calls, including calls made by a person in the interface.

## What this server will not do

\`execute_indesign_code\` is disabled and stays that way. \`set_properties\` and
\`call_method\` are not a way around it: property paths are checked segment by
segment, enum references must be exactly \`Name.MEMBER\`, and the method list
excludes \`doScript\`, \`quit\` and \`eval\`. They pass data, never statements.

File paths are confined to \`INDESIGN_ALLOWED_DIRS\`. A path outside is refused
before any script is generated.
`;

export const TOOL_INDEX = `# Tool index by task

## Seeing what is there
\`inspect_page\` · \`check_layout\` · \`inspect_object\` · \`get_document_info\` ·
\`list_text_frames\` · \`list_layers\` · \`list_styles\` · \`list_color_swatches\` ·
\`list_master_pages\` · \`list_sections\` · \`list_links\` · \`get_selected_objects\` ·
\`get_text_content\` · \`find_text\` · \`analyze_embedded_objects\` ·
\`analyze_text_problems\` · \`find_typography_issues\` · \`list_grep_searches\` ·
\`preflight_document\`

## Making things
Documents and pages: \`create_document\` · \`open_document\` · \`save_document\` ·
\`close_document\` · \`add_page\` · \`delete_page\` · \`duplicate_page\` ·
\`navigate_to_page\` · \`create_section\`

Objects: \`create_text_frame\` · \`create_rectangle\` · \`create_ellipse\` ·
\`create_polygon\` · \`create_line\` · \`place_image\` · \`create_anchored_frame\` ·
\`create_table\` · \`populate_table\` · \`create_layer\`

Structure: \`thread_text_frames\` · \`apply_master_page\` · \`insert_page_number\` ·
\`insert_markdown_text\` · \`data_merge\`

## Changing what exists
Position and size: \`move_object\` · \`resize_object\` · \`delete_object\` ·
\`arrange_object\` · \`fit_frame\` · \`transform_object\` · \`transform_content\`

Arrangement: \`align_objects\` · \`distribute_objects\` · \`group_objects\` ·
\`ungroup_objects\`

Appearance: \`format_object\` · \`apply_effect\` · \`create_gradient\` ·
\`apply_color\` · \`format_table\`

Text: \`edit_text_frame\` · \`format_text\` · \`format_paragraph\` ·
\`find_replace_text\` · \`clean_imported_text\` · \`fix_typography_in_selection\` ·
\`set_text_frame_options\` · \`set_text_wrap\`

Styles: the paragraph, character and object style tools · \`create_color_swatch\`

Recovery: \`undo\`

## Output
\`export_pdf\` · \`export_images\` · \`export_epub\` · \`export_idml\` ·
\`package_document\` · \`update_links\` · \`view_document\` · \`zoom_to_page\`

Use \`export_idml\` when the file has to open somewhere else — an older
InDesign, or a different tool.

## Everything else
\`inspect_object\` · \`set_properties\` · \`call_method\` reach any property of any
object. See the guide resource for how, and for what they deliberately cannot
do.
`;

/** Resource contents by URI, or null if the URI is unknown. */
export function readResource(uri) {
  if (uri === GUIDE_URI) return GUIDE;
  if (uri === TOOLS_URI) return TOOL_INDEX;
  return null;
}
