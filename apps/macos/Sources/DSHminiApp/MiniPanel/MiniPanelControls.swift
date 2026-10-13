import AppKit
import SwiftUI

/// The open capsule's content: the Atd mark, the hairline, New task, Ask about selection,
/// Screenshot and, while the list is not empty, Commands, laid out with ``MiniPanelMetrics``
/// exactly as ``MiniPanelLayout/buttons`` places them. The controls arrive together with their
/// content's look, never one by one.
struct MiniPanelCapsule: View {
  let model: MiniPanelModel

  var body: some View {
    let controls = MiniPanelControl.buttons(hasCommands: !model.commands.isEmpty)
    VStack(spacing: 0) {
      ForEach(Array(controls.enumerated()), id: \.element) { index, control in
        if index == 1 {
          Rectangle()
            .fill(Color(nsColor: .separatorColor))
            .frame(
              width: MiniPanelMetrics.capsuleWidth - MiniPanelMetrics.hairlineInset * 2,
              height: MiniPanelMetrics.hairline
            )
            .padding(.vertical, MiniPanelMetrics.hairlineMargin)
            .accessibilityHidden(true)
        }
        MiniPanelButton(control: control, label: label(control), model: model)
          .padding(.top, index > 1 ? MiniPanelMetrics.buttonGap : 0)
      }
    }
    .padding(MiniPanelMetrics.padding)
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: model.labels.panel))
    .accessibilityIdentifier("miniPanel.capsule")
    .accessibilityAction(.escape) { model.collapse() }
  }

  private func label(_ control: MiniPanelControl) -> String {
    switch control {
    case .mark: model.markLabel
    case .newTask: model.labels.newTask
    case .ask: model.labels.ask
    case .screenshot: model.labels.screenshot
    case .commands, .row: model.labels.commands
    }
  }
}

/// The invite's content: the drop glyph.
struct MiniPanelInvite: View {
  let model: MiniPanelModel

  var body: some View {
    Image(nsImage: MiniPanelIcons.glyph(MiniPanelIcons.drop))
      .renderingMode(.template)
      .resizable()
      .frame(width: MiniPanelMetrics.glyphSide, height: MiniPanelMetrics.glyphSide)
      .foregroundStyle(.primary)
      .accessibilityElement()
      .accessibilityLabel(Text(verbatim: model.labels.drop))
      .accessibilityIdentifier("miniPanel.invite")
  }
}

/// The drop card's content: the larger drop glyph over its call to action, in the primary label
/// color on the same glass as every other shape (surface-v2).
struct MiniPanelDropCard: View {
  let model: MiniPanelModel

  var body: some View {
    VStack(spacing: 8) {
      Image(nsImage: MiniPanelIcons.glyph(MiniPanelIcons.drop))
        .renderingMode(.template)
        .resizable()
        .frame(width: MiniPanelMetrics.targetGlyphSide, height: MiniPanelMetrics.targetGlyphSide)
        .accessibilityHidden(true)
      Text(verbatim: model.labels.drop)
        .font(.system(size: 13, weight: .medium))
        .multilineTextAlignment(.center)
        .lineLimit(2)
    }
    .foregroundStyle(.primary)
    .padding(12)
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("miniPanel.target")
  }
}

/// A capsule button: a 16 pt template glyph in a 32 pt circle, concentric with the capsule. Its
/// hover and press come from ``MiniPanelModel`` (the controller reads the pointer and holds the
/// press), not from SwiftUI's own tracking, which lags while Atd is inactive; the click itself
/// arrives replayed after the release (``MiniPanelWindow``), and VoiceOver presses it directly.
/// Its name shows in the panel's own hover label, not a system tooltip. Only its wash and its
/// glyph's press read the pointer, so a hover or a press redraws them alone (perf-v1).
struct MiniPanelButton: View {
  let control: MiniPanelControl
  let label: String
  let model: MiniPanelModel

  var body: some View {
    Button {
      model.perform(control)
    } label: {
      Image(nsImage: MiniPanelIcons.glyph(for: control))
        .renderingMode(.template)
        .resizable()
        .scaledToFit()
        .frame(width: MiniPanelMetrics.glyphSide, height: MiniPanelMetrics.glyphSide)
        .modifier(MiniPanelGlyphPress(control: control, model: model))
        .frame(width: MiniPanelMetrics.buttonSide, height: MiniPanelMetrics.buttonSide)
        .background { MiniPanelWash(control: control, model: model, shape: Circle()) }
        .contentShape(Circle())
    }
    .buttonStyle(MiniPanelButtonStyle())
    .foregroundStyle(.primary)
    .accessibilityLabel(Text(verbatim: label))
    .accessibilityIdentifier(control.identifier)
  }
}

/// The commands card: one row per command, at most ``MiniPanelMetrics/maxVisibleRows`` visible
/// before the list scrolls. Names are user data: untranslated, cut with an ellipsis, the full
/// name in the hover label and for VoiceOver. The scroll offset goes back to the model, so the
/// pointer tracking finds the row under the pointer.
///
/// The rows follow the card as drawn (`card`, resting at `rest`, both in its lane) and arrive and
/// leave on their own presence. Inside a scroll view they do so about the middle of the rows
/// that show: the scroll view itself takes no transform, since AppKit moves its scroll position
/// when the view it lies in is moved or scaled. A list that scrolls shows its own scrollbar in the
/// card's trailing padding (``MiniPanelScrollThumb``) rather than the system scroller, so the
/// padding is the same on both sides and nothing covers a row; its thumb is dragged through the
/// controller, which holds every press on the panel, and scrolls the rows through
/// ``MiniPanelModel/flyoutScrollTarget``.
struct MiniPanelFlyout: View {
  let model: MiniPanelModel
  let card: MiniPanelGlassRect
  let rest: CGRect
  let animation: Animation?
  @State private var scroll = MiniPanelScrollMetrics()
  @State private var position = ScrollPosition(edge: .top)

  var body: some View {
    let scrolls = model.commands.count > MiniPanelMetrics.maxVisibleRows
    Group {
      // A scroll view only when the list scrolls: it costs every frame the card moves.
      if scrolls {
        let shown = rest.height - MiniPanelMetrics.cardPadding * 2
        ScrollView(.vertical) { rows(middleY: model.flyoutScroll + shown / 2) }
          .scrollIndicators(.hidden)
          .scrollPosition($position)
          .onScrollGeometryChange(for: MiniPanelScrollMetrics.Geometry.self) { geometry in
            MiniPanelScrollMetrics.Geometry(geometry)
          } action: { _, geometry in
            model.flyoutScroll = geometry.offset
            scroll.geometry = geometry
          }
          // The thumb's drag scrolls the rows at once.
          .onChange(of: model.flyoutScrollTarget) { _, target in
            if let target { position.scrollTo(y: target) }
          }
      } else {
        rows(middleY: nil)
      }
    }
    .padding(MiniPanelMetrics.cardPadding)
    .overlay {
      if scrolls {
        MiniPanelScrollThumb(model: model, metrics: scroll, size: rest.size)
          .animation(animation) { $0.modifier(follow(middleY: nil)) }
          .modifier(MiniPanelPresenceEffect(presence: model.presence(.rows)))
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(Text(verbatim: model.labels.commands))
    .accessibilityIdentifier("miniPanel.flyout")
  }

  private func follow(middleY: Double?) -> MiniPanelFollowEffect {
    MiniPanelFollowEffect(shape: card, rest: rest, scales: !model.reduceMotion, middleY: middleY)
  }

  private func rows(middleY: Double?) -> some View {
    VStack(spacing: 0) {
      // 枚举快照进 ForEach、内容闭包只读自己的元组——**绝不在求值时回读活体数组**。
      // setCommands 会在事务中换数组（发送时刻命令目录会随新会话注册收缩），按
      // indices 枚举 + 内容回读，过渡态用陈旧下标打活数组：轻则宿主图中毒静默
      // 停帧（面板整窗不再上画），重则主线程越界（EXC_BREAKPOINT，崩溃报告里的
      // MiniPanelFlyout.rows(middleY:) 帧）。
      ForEach(Array(model.commands.enumerated()), id: \.offset) { command in
        MiniPanelRow(index: command.offset, name: command.element.name, model: model)
      }
    }
    .animation(animation) { $0.modifier(follow(middleY: middleY)) }
    .modifier(MiniPanelPresenceEffect(presence: model.presence(.rows)))
  }
}

/// A command row: its name on the card's wash, which shows the press (a row has no glyph to
/// squish).
private struct MiniPanelRow: View {
  let index: Int
  let name: String
  let model: MiniPanelModel

  var body: some View {
    Button {
      model.perform(.row(index))
    } label: {
      Text(verbatim: name)
        .font(.system(size: 13, weight: .medium))
        .lineLimit(1)
        .truncationMode(.tail)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, MiniPanelMetrics.rowPadding)
        .frame(height: MiniPanelMetrics.rowHeight)
        .background {
          MiniPanelWash(
            control: .row(index), model: model,
            shape: RoundedRectangle(cornerRadius: MiniPanelMetrics.rowRadius, style: .continuous))
        }
        .contentShape(Rectangle())
    }
    .buttonStyle(MiniPanelButtonStyle())
    .foregroundStyle(.primary)
    .accessibilityLabel(Text(verbatim: name))
    .accessibilityIdentifier(MiniPanelControl.row(index).identifier)
  }
}

/// A press squishes the glyph in at once and springs it back on release (motion-v2); Reduce
/// Motion keeps it still and lets the wash show the press.
private struct MiniPanelGlyphPress: ViewModifier {
  let control: MiniPanelControl
  let model: MiniPanelModel

  func body(content: Content) -> some View {
    let pressed = model.pressed == control
    let release = MiniPanelChoreography.controlRelease.reduced(model.reduceMotion)
    content
      .scaleEffect(
        pressed && !model.reduceMotion ? MiniPanelChoreography.controlPressScale : 1
      )
      .animation(
        pressed ? MiniPanelChoreography.controlPress.animation : release.animation,
        value: pressed)
  }
}

/// A control's hover or press wash: a neutral fill in the label color, with a visible 1 pt edge
/// under Increase Contrast, which adds none to custom fills. It reads the pointer's control and
/// the press itself, so they redraw it alone.
struct MiniPanelWash<Outline: InsettableShape>: View {
  let control: MiniPanelControl
  let model: MiniPanelModel
  let shape: Outline
  @Environment(\.colorSchemeContrast) private var contrast

  var body: some View {
    let level = model.washLevel(control)
    shape
      .fill(Color.primary.opacity(level))
      .overlay {
        if contrast == .increased, level > 0 {
          shape.strokeBorder(Color.primary.opacity(0.6), lineWidth: 1)
        }
      }
  }
}

extension MiniPanelModel {
  /// A control's wash: none at rest, light under the pointer, stronger while pressed, strongest
  /// pressed with Reduce Motion, where the wash stands in for the glyph's squish.
  func washLevel(_ control: MiniPanelControl) -> Double {
    if pressed == control { return reduceMotion ? 0.24 : 0.16 }
    return hovered == control ? 0.1 : 0
  }
}

/// The label as it is: the press shows from the model, since the window holds every press until
/// its release.
private struct MiniPanelButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
  }
}
