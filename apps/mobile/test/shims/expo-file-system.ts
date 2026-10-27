export class File {
  constructor(public uri: string) {}
  exists = true;
  delete() {}
}
export class Directory {}
export const Paths = {};
export enum UploadType {
  BINARY_CONTENT = 0,
}
