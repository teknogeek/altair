import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DoCheck,
  ElementRef,
  EventEmitter,
  forwardRef,
  HostBinding,
  Input,
  KeyValueDiffers,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { EditorState, Extension, StateEffect } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
} from '@codemirror/autocomplete';
import {
  syntaxHighlighting,
  HighlightStyle,
  foldGutter,
  bracketMatching,
} from '@codemirror/language';

import { tags as t } from '@lezer/highlight';

@Component({
  selector: 'app-codemirror',
  templateUrl: './codemirror.component.html',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CodemirrorComponent),
      multi: true,
    },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodemirrorComponent
  implements AfterViewInit, OnChanges, ControlValueAccessor, OnDestroy
{
  @Input() extensions: Extension[] = [];
  @Input() @HostBinding('class.cm6-full-height') fullHeight = false;
  @Input() showLineNumber = true;
  @Input() foldGutter = true;
  @Input() wrapLines = true;

  // Specifies the editor should not have any default extensions
  @Input() bare = false;

  @Output() focusChange = new EventEmitter<boolean>();

  @ViewChild('ref') ref!: ElementRef<HTMLTextAreaElement>;

  private view: EditorView;
  private value = '';
  private onTouched = () => {};
  private onChange = (s: string) => {};

  constructor(private zone: NgZone, private differ: KeyValueDiffers) {}

  ngAfterViewInit() {
    this.zone.runOutsideAngular(() => {
      const updateListener = EditorView.updateListener.of((vu: ViewUpdate) => {
        if (vu.docChanged) {
          const doc = vu.state.doc;
          const value = doc.toString();
          this.zone.run(() => this.codemirrorValueChanged(value));
        }
        if (vu.focusChanged) {
          this.zone.run(() => this.focusChanged(vu.view.hasFocus));
        }
      });
      const baseTheme = EditorView.theme({
        '&.cm-editor.cm-focused': {
          outline: 'none',
        },
        '.cm-tooltip.cm-tooltip-autocomplete': {
          background: 'var(--theme-bg-color)',
          border: '1px solid var(--theme-border-color)',
          borderRadius: '4px',
          padding: '4px',
          fontSize:
            'calc((var(--editor-font-size) / var(--baseline-size)) * 1rem)',

          '& > ul': {
            fontFamily: 'var(--editor-font-family)',
            whiteSpace: 'nowrap',
            overflow: 'hidden auto',
            maxWidth_fallback: '700px',
            maxWidth: 'min(700px, 95vw)',
            minWidth: '250px',
            maxHeight: '10em',
            listStyle: 'none',
            margin: 0,
            padding: 0,
            background: 'var(--theme-bg-color)',
            color: 'var(--theme-font-color)',

            '& > li': {
              overflowX: 'hidden',
              textOverflow: 'ellipsis',
              cursor: 'pointer',
              padding: '2px 4px',
              lineHeight: 1.4,
            },
          },
        },

        '.cm-tooltip-autocomplete ul li': {
          background: 'var(--theme-bg-color)',
          color: 'var(--theme-font-color)',
          borderRadius: '4px',
        },

        '.cm-tooltip-autocomplete ul li[aria-selected]': {
          background: 'var(--primary-color)',
        },

        // '&dark .cm-tooltip-autocomplete ul li[aria-selected]': {
        //   background: '#347',
        //   color: 'white',
        // },

        '.cm-tooltip.cm-completionInfo': {
          position: 'absolute',
          padding: '4px',
          borderRadius: '4px',
          width: 'max-content',
          maxWidth: '400px',
          background: 'var(--theme-bg-color)',
          color: 'var(--theme-font-color)',
          lineHeight: '1.4',
          border: '1px solid var(--theme-border-color)',
          margin: '0 4px',
        },

        '.cm-completionInfo.cm-completionInfo-left': { right: '100%' },
        '.cm-completionInfo.cm-completionInfo-right': { left: '100%' },

        // '&light .cm-snippetField': {backgroundColor: '#00000022'},
        // '&dark .cm-snippetField': {backgroundColor: '#ffffff22'},
        '.cm-snippetFieldPosition': {
          verticalAlign: 'text-top',
          width: 0,
          height: '1.15em',
          margin: '0 -0.7px -.7em',
          borderLeft: '1.4px dotted #888',
        },

        '.cm-completionMatchedText': {
          textDecoration: 'none',
          fontWeight: 'bold',
        },
      });
      // https://github.com/codemirror/theme-one-dark/blob/848ca1e82addf4892afc895e013754805af6182a/src/one-dark.ts#L96
      const defaultHighlightStyle = HighlightStyle.define([
        { tag: t.keyword, color: 'var(--editor-keyword-color)' },
        {
          tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName],
          color: 'var(--editor-property-color)',
        },
        {
          tag: [t.function(t.variableName), t.labelName],
          color: 'var(--editor-variable-color)',
        },
        {
          tag: [t.color, t.constant(t.name), t.standard(t.name)],
          color: 'var(--editor-builtin-color)',
        },
        {
          tag: [t.definition(t.name), t.separator],
          color: 'var(--editor-def-color)',
        },
        {
          tag: [
            t.typeName,
            t.className,
            t.number,
            t.changed,
            t.annotation,
            t.modifier,
            t.self,
            t.namespace,
          ],
          color: 'var(--editor-number-color)',
        },
        {
          tag: [
            t.operator,
            t.operatorKeyword,
            t.url,
            t.escape,
            t.regexp,
            t.link,
            t.special(t.string),
          ],
          color: 'var(--editor-keyword-color)',
        },
        { tag: [t.meta, t.comment], color: 'var(--editor-comment-color)' },
        {
          tag: [t.attributeName, t.attributeValue],
          color: 'var(--editor-attribute-color)',
        },
        { tag: [t.punctuation], color: 'var(--editor-punctuation-color)' },
        { tag: t.strong, fontWeight: 'bold' },
        { tag: t.emphasis, fontStyle: 'italic' },
        { tag: t.strikethrough, textDecoration: 'line-through' },
        {
          tag: [t.atom, t.bool, t.special(t.variableName)],
          color: 'var(--editor-atom-color)',
        },
        {
          tag: [t.processingInstruction, t.string, t.inserted],
          color: 'var(--editor-string-color)',
        },
      ]);

      const baseExtensions = [
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...closeBracketsKeymap,
        ]),
        this.showLineNumber ? lineNumbers() : [],
        this.foldGutter ? foldGutter() : [],
        this.wrapLines ? EditorView.lineWrapping : [],
        // highlightActiveLineGutter(),
        bracketMatching(),
        closeBrackets(),
        history(),
        autocompletion(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      ];
      const startState = EditorState.create({
        doc: this.value,
        extensions: [
          updateListener,
          !this.bare ? [...baseExtensions] : [],

          baseTheme,
          ...this.extensions,
        ],
      });

      this.view = new EditorView({
        state: startState,
        parent: this.ref.nativeElement,
      });
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.view && changes.extensions?.currentValue) {
      this.view.dispatch({
        effects: StateEffect.reconfigure.of(changes.extensions.currentValue),
      });
    }
  }

  ngOnDestroy() {
    this.view.destroy();
  }

  writeValue(value: string) {
    if (value === null || value === undefined) {
      return;
    }

    const editorValue = this.view.state.doc.toString();

    if (editorValue !== value) {
      this.value = value;
      this.view.dispatch({
        changes: { from: 0, to: this.view.state.doc.length, insert: value },
      });
    }
  }

  registerOnChange(fn: (s: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void) {
    this.onTouched = fn;
  }

  codemirrorValueChanged(value: string) {
    if (this.value !== value) {
      this.value = value;
      this.onChange(value);
    }
  }

  focusChanged(focused: boolean) {
    this.onTouched();
    this.focusChange.emit(focused);
  }
}
