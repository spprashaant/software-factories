declare const format: unique symbol;

export type Markdown = string & { readonly [format]: "Markdown" };
export type PlainText = string & { readonly [format]: "PlainText" };

export const asMarkdown = (text: string) => text as Markdown;
export const asPlainText = (text: string) => text as PlainText;
