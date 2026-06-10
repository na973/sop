'use client';

import { useCallback, useRef, useState } from 'react';
import { useAppState, type FileEntry } from '@/lib/app-state';

interface FileSelectorProps {
  /** 当前步骤编号(1-8) */
  step: number;
  /** 接受的文件类型 */
  accept?: string;
  /** 是否必须选择文件才能执行 */
  required?: boolean;
  /** 选中文件后的回调 */
  onFileSelected?: (file: FileEntry) => void;
}

export function FileSelector({ step, accept = '.xlsx,.xls', required = true, onFileSelected }: FileSelectorProps) {
  const { state, addFile, selectFile, getSelectedFile } = useAppState();
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedFile = getSelectedFile(step);
  const allowedTypes = new Set([
    accept.includes('.xls') ? 'excel' : '',
    accept.includes('.pdf') ? 'pdf' : '',
    accept.includes('.txt') ? 'text' : '',
  ].filter(Boolean));
  const selectableFiles = state.fileLibrary.filter((f) => allowedTypes.has(f.type));

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        const lowerName = file.name.toLowerCase();
        const type: FileEntry['type'] = lowerName.endsWith('.pdf') ? 'pdf' : lowerName.endsWith('.txt') ? 'text' : 'excel';
        const id = addFile({ name: file.name, base64, type });
        selectFile(step, id);
        const newEntry = { id, name: file.name, base64, type, uploadedAt: Date.now() };
        onFileSelected?.(newEntry);
      };
      reader.readAsDataURL(file);
    },
    [addFile, selectFile, step, onFileSelected],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleSelectExisting = useCallback(
    (fileId: string) => {
      selectFile(step, fileId);
      const f = state.fileLibrary.find((entry) => entry.id === fileId);
      if (f) onFileSelected?.(f);
    },
    [selectFile, step, state.fileLibrary, onFileSelected],
  );

  const acceptLabel = accept.includes('.pdf') && accept.includes('.xls') ? 'Excel或PDF文件' : accept.includes('.pdf') ? 'PDF文件' : accept.includes('.txt') ? '文本文件' : 'Excel文件';

  return (
    <div className="space-y-3">
      {/* 拖拽上传区域 */}
      <div
        className={`border-2 border-dashed rounded-md p-4 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        {selectedFile ? (
          <div className="text-sm">
            <span className="font-medium text-foreground">{selectedFile.name}</span>
            <span className="text-muted-foreground ml-2">({(selectedFile.base64.length * 0.75 / 1024).toFixed(0)} KB)</span>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            拖拽{acceptLabel}到此处，或<span className="text-primary underline">点击上传</span>
          </div>
        )}
      </div>

      {/* 文件库选择 */}
      {state.fileLibrary.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">从文件库选择：</div>
          <div className="flex flex-wrap gap-1.5">
            {selectableFiles.map((f) => (
              <button
                key={f.id}
                onClick={() => handleSelectExisting(f.id)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  selectedFile?.id === f.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:border-primary/50 text-muted-foreground hover:text-foreground'
                }`}
                title={f.name}
              >
                {f.type === 'pdf' ? '📄' : f.type === 'text' ? '📃' : '📊'} {f.name.length > 20 ? f.name.slice(0, 17) + '...' : f.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
