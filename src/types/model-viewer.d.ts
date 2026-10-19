// <model-viewer> Web Component 的 JSX 类型声明(React 19 经 react 模块增强 JSX)。
// tsconfig 的 include "**/*.ts" 会自动收录本文件。
import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import type { ModelViewerElement } from '@google/model-viewer';

type ModelViewerAttributes = DetailedHTMLProps<HTMLAttributes<ModelViewerElement>, ModelViewerElement> & {
  src?: string;
  alt?: string;
  poster?: string;
  'camera-controls'?: boolean;
  'auto-rotate'?: boolean;
  'rotation-per-second'?: string;
  'interaction-prompt'?: 'auto' | 'none';
  'shadow-intensity'?: string | number;
  'environment-image'?: string;
  exposure?: string | number;
  ar?: boolean;
  loading?: 'auto' | 'lazy' | 'eager';
  reveal?: 'auto' | 'interaction' | 'manual';
};

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': ModelViewerAttributes;
    }
  }
}
