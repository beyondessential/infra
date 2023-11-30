import { Input, Output, all, output } from '@pulumi/pulumi';

export interface ClassicTagInput {
  [key: string]: Input<string>;
}

export interface ClassicTagOutput {
  [key: string]: Output<string>;
}

export interface NativeTagInput {
  key: Input<string>;
  value: Input<string>;
}

export interface NativeTagOutput {
  key: Output<string>;
  value: Output<string>;
}

export function nativeTags(...manyTags: Input<ClassicTagInput>[]): Output<NativeTagOutput[]> {
  return all(manyTags).apply((manyTags) => {
    return Object.entries(Object.assign({}, ...manyTags)).map(([key, value]) => ({
      key: output(key),
      value: output(value as string),
    }));
  });
}

export function classicTags(tags: Input<NativeTagInput>): Output<ClassicTagOutput> {
  return output(tags).apply((tags) => {
    return Object.fromEntries(Object.entries(tags).map(([key, value]) => [key, output(value)]));
  });
}
