declare module 'opencc-js' {
  export interface ConverterOptions {
    from: string;
    to: string;
  }

  export type Converter = (input: string) => string;

  export function Converter(options: ConverterOptions): Converter;

  const OpenCC: {
    Converter: typeof Converter;
  };

  export default OpenCC;
}