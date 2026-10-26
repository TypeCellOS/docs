import { diagramBlockMapping } from '@blocknote/diagram-block/docx-exporter';
import {
  inlineMathMapping,
  mathBlockMapping,
} from '@blocknote/math-block/docx-exporter';
import { docxDefaultSchemaMappings } from '@blocknote/xl-docx-exporter';

import {
  blockMappingCalloutDocx,
  blockMappingImageDocx,
  blockMappingQuoteDocx,
  blockMappingUploadLoaderDocx,
} from './blocks-mapping';
import { createInlineContentMappingInterlinkingLinkDocx } from './inline-content-mapping';
import { DocsExporterDocx } from './types';

const tableMapping = docxDefaultSchemaMappings.blockMapping.table;

// NaN widths are not supported by DOCX. Keep the mapping's shape intact:
// function mappings let the exporter append and indent child blocks itself.
const normalizeColumnWidths = (widths: (number | undefined)[]) =>
  widths.map((width) =>
    typeof width === 'number' && Number.isNaN(width) ? undefined : width,
  );

export const getDocxDocsSchemaMappings = (
  interlinkTitles: Map<string, string>,
): DocsExporterDocx['mappings'] => ({
  ...docxDefaultSchemaMappings,
  blockMapping: {
    ...docxDefaultSchemaMappings.blockMapping,
    callout: blockMappingCalloutDocx,
    // We're reusing the file block mapping for PDF blocks; both share the same
    // implementation signature, so we can reuse the handler directly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pdf: docxDefaultSchemaMappings.blockMapping.file as any,
    // Renders the LaTeX as a native (editable) Word equation.
    mathBlock: mathBlockMapping,
    // Renders the Mermaid source to a PNG in the browser (async mapping).
    diagram: diagramBlockMapping,
    quote: blockMappingQuoteDocx,
    image: blockMappingImageDocx,
    uploadLoader: blockMappingUploadLoaderDocx,
    table:
      typeof tableMapping === 'function'
        ? (block, exporter, nestedLevel, numberedListIndex) => {
            block.content.columnWidths = normalizeColumnWidths(
              block.content.columnWidths,
            );
            return tableMapping(
              block,
              exporter,
              nestedLevel,
              numberedListIndex,
            );
          }
        : {
            withChildren: (
              block,
              exporter,
              nestedLevel,
              numberedListIndex,
              children,
            ) => {
              block.content.columnWidths = normalizeColumnWidths(
                block.content.columnWidths,
              );
              return tableMapping.withChildren(
                block,
                exporter,
                nestedLevel,
                numberedListIndex,
                children,
              );
            },
          },
  },
  inlineContentMapping: {
    ...docxDefaultSchemaMappings.inlineContentMapping,
    interlinkingLinkInline:
      createInlineContentMappingInterlinkingLinkDocx(interlinkTitles),
    // Renders inline math as a native (editable) Word equation.
    math: inlineMathMapping,
  },
  styleMapping: {
    ...docxDefaultSchemaMappings.styleMapping,
    // Switch to core PDF "Courier" font to avoid relying on GeistMono
    // that is not available in italics
    code: (enabled?: boolean) =>
      enabled
        ? {
            font: 'Courier New',
            shading: { fill: 'DCDCDC' },
          }
        : {},
  },
});
