import { Type, type Static } from 'typebox';

/**
 * Desktop widgets of user apps. A backend's `defineWidget` render returns a `WidgetTimeline` whose
 * entries carry a view tree of the nodes below (not HTML): the WidgetKit extension renders them
 * natively in SwiftUI, so the schema is exported to JSON Schema and the Swift Codable types are
 * generated from it. The tree is recursive through `Type.Cyclic` (`$defs.WidgetNode`, referenced
 * by `$ref: "WidgetNode"`). The schema bounds every list; the service additionally rejects a tree
 * deeper than `WIDGET_MAX_DEPTH` or a snapshot over `WIDGET_SNAPSHOT_MAX_BYTES`, drops it and
 * writes a `widget` diagnostic.
 */

export const WIDGET_TIMELINE_MAX_ENTRIES = 24;
export const WIDGET_LIST_MAX_ROWS = 8;
export const WIDGET_CHART_MAX_POINTS = 50;
export const WIDGET_STACK_MAX_CHILDREN = 16;
export const WIDGET_MAX_DEPTH = 8;
/** One serialized `WidgetSnapshot`, in UTF-8 bytes. */
export const WIDGET_SNAPSHOT_MAX_BYTES = 64 * 1024;
/** One `image` node's file in the app's current version; PNG or JPEG. */
export const WIDGET_IMAGE_MAX_BYTES = 256 * 1024;
/** The shortest refresh interval WidgetKit's budget allows a widget to ask for. */
export const WIDGET_MIN_REFRESH_MINUTES = 15;

export const WidgetFamilySchema = Type.Union([
  Type.Literal('systemSmall'),
  Type.Literal('systemMedium'),
  Type.Literal('systemLarge'),
]);
export type WidgetFamily = Static<typeof WidgetFamilySchema>;

/**
 * Semantic color tokens; the extension maps them to the system palette in light and dark. `accent`
 * is the app's manifest `accentColor`, adapted to the appearance, or the system accent without one.
 */
export const WidgetColorSchema = Type.Union([
  Type.Literal('primary'),
  Type.Literal('secondary'),
  Type.Literal('accent'),
  Type.Literal('destructive'),
  Type.Literal('success'),
  Type.Literal('warning'),
]);
export type WidgetColor = Static<typeof WidgetColorSchema>;

/** A stack's fill: a color token, or the widget's own container background. */
export const WidgetBackgroundSchema = Type.Union([
  WidgetColorSchema,
  Type.Literal('containerBackground'),
]);
export type WidgetBackground = Static<typeof WidgetBackgroundSchema>;

/** SwiftUI text styles from `largeTitle` down to `footnote`. */
export const WidgetTextStyleSchema = Type.Union([
  Type.Literal('largeTitle'),
  Type.Literal('title'),
  Type.Literal('title2'),
  Type.Literal('title3'),
  Type.Literal('headline'),
  Type.Literal('subheadline'),
  Type.Literal('body'),
  Type.Literal('callout'),
  Type.Literal('footnote'),
]);
export type WidgetTextStyle = Static<typeof WidgetTextStyleSchema>;

export const WidgetFontWeightSchema = Type.Union([
  Type.Literal('regular'),
  Type.Literal('medium'),
  Type.Literal('semibold'),
  Type.Literal('bold'),
]);
export type WidgetFontWeight = Static<typeof WidgetFontWeightSchema>;

/** A route inside the app (`/`, `/notes/42?tab=all`); a tap opens the app window there. */
export const WidgetRouteSchema = Type.String({ minLength: 1, maxLength: 512, pattern: '^/\\S*$' });
export type WidgetRoute = Static<typeof WidgetRouteSchema>;

/** ISO 8601 date-time with an offset, as `Date.prototype.toISOString` writes it. */
const DateTime = Type.String({ format: 'date-time', maxLength: 64 });
const Label = (maxLength: number) => Type.String({ maxLength });
const Spacing = Type.Number({ minimum: 0, maximum: 32 });

/** One `list` row: structured, so the extension lays every row out the same way. */
export const WidgetListRowSchema = Type.Object(
  {
    title: Label(200),
    subtitle: Type.Optional(Label(200)),
    /** SF Symbol shown before the title. */
    symbol: Type.Optional(Type.String({ minLength: 1, maxLength: 100, pattern: '^[a-z0-9.]+$' })),
    /** Short text at the trailing edge (a count, a time). */
    trailing: Type.Optional(Label(64)),
    color: Type.Optional(WidgetColorSchema),
  },
  { additionalProperties: false },
);
export type WidgetListRow = Static<typeof WidgetListRowSchema>;

export const WidgetChartPointSchema = Type.Object(
  { x: Label(32), y: Type.Number() },
  { additionalProperties: false },
);
export type WidgetChartPoint = Static<typeof WidgetChartPointSchema>;

const NodeRef = Type.Ref('WidgetNode');
const Children = Type.Array(NodeRef, { maxItems: WIDGET_STACK_MAX_CHILDREN });
const stackFields = {
  children: Children,
  spacing: Type.Optional(Spacing),
  padding: Type.Optional(Spacing),
  background: Type.Optional(WidgetBackgroundSchema),
};

/**
 * One view-tree node, discriminated by `type`. Every node except `spacer` and `divider` may carry
 * a semantic `color`; text-like nodes take a `style`. `image.src` is a path relative to the app's
 * current version web root (PNG or JPEG, at most `WIDGET_IMAGE_MAX_BYTES`); `date` renders with a
 * system-updated `relative`, `time` or `timer` style; `link` makes its child open `route`.
 */
export const WidgetNodeSchema = Type.Cyclic(
  {
    WidgetNode: Type.Union([
      Type.Object(
        {
          type: Type.Literal('vstack'),
          alignment: Type.Optional(
            Type.Union([Type.Literal('leading'), Type.Literal('center'), Type.Literal('trailing')]),
          ),
          ...stackFields,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          type: Type.Literal('hstack'),
          alignment: Type.Optional(
            Type.Union([Type.Literal('top'), Type.Literal('center'), Type.Literal('bottom')]),
          ),
          ...stackFields,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          type: Type.Literal('zstack'),
          alignment: Type.Optional(
            Type.Union([
              Type.Literal('center'),
              Type.Literal('top'),
              Type.Literal('bottom'),
              Type.Literal('leading'),
              Type.Literal('trailing'),
              Type.Literal('topLeading'),
              Type.Literal('topTrailing'),
              Type.Literal('bottomLeading'),
              Type.Literal('bottomTrailing'),
            ]),
          ),
          ...stackFields,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        { type: Type.Literal('spacer'), minLength: Type.Optional(Spacing) },
        { additionalProperties: false },
      ),
      Type.Object({ type: Type.Literal('divider') }, { additionalProperties: false }),
      Type.Object(
        {
          type: Type.Literal('text'),
          text: Label(500),
          style: Type.Optional(WidgetTextStyleSchema),
          weight: Type.Optional(WidgetFontWeightSchema),
          color: Type.Optional(WidgetColorSchema),
          lineLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          type: Type.Literal('symbol'),
          /** SF Symbol name (`checkmark.circle.fill`). */
          name: Type.String({ minLength: 1, maxLength: 100, pattern: '^[a-z0-9.]+$' }),
          size: Type.Optional(Type.Number({ minimum: 8, maximum: 96 })),
          color: Type.Optional(WidgetColorSchema),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          type: Type.Literal('image'),
          src: Type.String({
            maxLength: 256,
            pattern: '^[A-Za-z0-9_-][A-Za-z0-9_.-]*(/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*\\.(png|jpe?g)$',
          }),
          contentMode: Type.Optional(Type.Union([Type.Literal('fit'), Type.Literal('fill')])),
          width: Type.Optional(Type.Number({ minimum: 1, maximum: 512 })),
          height: Type.Optional(Type.Number({ minimum: 1, maximum: 512 })),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          type: Type.Literal('gauge'),
          value: Type.Number(),
          min: Type.Optional(Type.Number()),
          max: Type.Optional(Type.Number()),
          label: Type.Optional(Label(64)),
          style: Type.Optional(Type.Union([Type.Literal('circular'), Type.Literal('linear')])),
          color: Type.Optional(WidgetColorSchema),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          type: Type.Literal('progress'),
          /** Fraction done, 0 to 1. */
          value: Type.Number({ minimum: 0, maximum: 1 }),
          label: Type.Optional(Label(64)),
          color: Type.Optional(WidgetColorSchema),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          type: Type.Literal('date'),
          date: DateTime,
          style: Type.Union([
            Type.Literal('relative'),
            Type.Literal('time'),
            Type.Literal('timer'),
          ]),
          textStyle: Type.Optional(WidgetTextStyleSchema),
          color: Type.Optional(WidgetColorSchema),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          type: Type.Literal('list'),
          rows: Type.Array(WidgetListRowSchema, { maxItems: WIDGET_LIST_MAX_ROWS }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          type: Type.Literal('chart'),
          kind: Type.Union([Type.Literal('line'), Type.Literal('bar')]),
          points: Type.Array(WidgetChartPointSchema, { maxItems: WIDGET_CHART_MAX_POINTS }),
          color: Type.Optional(WidgetColorSchema),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        { type: Type.Literal('link'), route: WidgetRouteSchema, child: NodeRef },
        { additionalProperties: false },
      ),
    ]),
  },
  'WidgetNode',
);
export type WidgetNode = Static<typeof WidgetNodeSchema>;

/** One timeline entry: the tree WidgetKit shows from `date` on; `route` is the whole-widget tap. */
export const WidgetEntrySchema = Type.Object(
  { date: DateTime, view: WidgetNodeSchema, route: Type.Optional(WidgetRouteSchema) },
  { additionalProperties: false },
);
export type WidgetEntry = Static<typeof WidgetEntrySchema>;

/** What one render returns, entries in ascending `date`. */
export const WidgetTimelineSchema = Type.Object(
  {
    entries: Type.Array(WidgetEntrySchema, {
      minItems: 1,
      maxItems: WIDGET_TIMELINE_MAX_ENTRIES,
    }),
  },
  { additionalProperties: false },
);
export type WidgetTimeline = Static<typeof WidgetTimelineSchema>;

/** A widget id, unique within its app (`today`, `habit-streak`). */
export const WidgetIdSchema = Type.String({ pattern: '^[a-z][a-z0-9-]{0,31}$' });
export type WidgetId = Static<typeof WidgetIdSchema>;

/** A widget a backend declares with `defineWidget`, reported in the backend's `ready` message. */
export const WidgetDeclSchema = Type.Object(
  {
    id: WidgetIdSchema,
    title: Type.String({ minLength: 1, maxLength: 64 }),
    description: Label(200),
    families: Type.Array(WidgetFamilySchema, { minItems: 1, maxItems: 3, uniqueItems: true }),
    refreshMinutes: Type.Integer({ minimum: WIDGET_MIN_REFRESH_MINUTES, maximum: 1440 }),
  },
  { additionalProperties: false },
);
export type WidgetDecl = Static<typeof WidgetDeclSchema>;

/**
 * Per-instance render configuration the parent passes to a backend's widget render. v1 widgets
 * have no parameters beyond the app and widget the user picked, so the shell sends `{}`.
 */
export const WidgetConfigSchema = Type.Record(
  Type.String({ maxLength: 64 }),
  Type.Union([Type.String({ maxLength: 500 }), Type.Number(), Type.Boolean()]),
);
export type WidgetConfig = Static<typeof WidgetConfigSchema>;
