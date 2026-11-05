export type FileCategory = 
  | 'code'
  | 'image'
  | 'document'
  | 'data'
  | 'audio'
  | 'video'
  | 'archive'
  | 'text'
  | 'binary';

export interface ExtractedFile {
  id: string;
  name: string;
  path: string;
  size: number;
  type: string;
  category: FileCategory;
  extension: string;
  content?: string | ArrayBuffer;
  isText: boolean;
  isImage: boolean;
  isAudio: boolean;
  isVideo: boolean;
  isPdf: boolean;
  isCsvOrJson: boolean;
  isMarkdown: boolean;
  modifiedDate?: Date;
  binaryData?: Uint8Array;
}

export interface DirectoryNode {
  name: string;
  path: string;
  isFolder: true;
  children: (DirectoryNode | ExtractedFileNode)[];
}

export interface ExtractedFileNode {
  name: string;
  path: string;
  isFolder: false;
  file: ExtractedFile;
}

export type TreeNode = DirectoryNode | ExtractedFileNode;

export interface ArchiveStats {
  totalFiles: number;
  totalDirectories: number;
  totalSize: number;
  compressedSize?: number;
  categoryCounts: Record<FileCategory, number>;
  extensionCounts: Record<string, number>;
}

export interface SearchFilter {
  query: string;
  category: FileCategory | 'all';
  maxSizeMB?: number;
  extension?: string;
}

export type ViewMode = 'split' | 'full-tree' | 'full-preview' | 'ai-insights';
export type Language = 'en' | 'ar';
