import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins

/// 配对二维码图（`data:image/png;base64,…`）。用系统 CoreImage 生成，
/// 不引第三方 QR 库，也不把配对链接交给任何在线生成服务。
enum QRCode {
    static func dataURL(text: String, scale: CGFloat = 8) -> String? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: scale, y: scale)),
              let cgImage = CIContext().createCGImage(output, from: output.extent) else { return nil }
        let rep = NSBitmapImageRep(cgImage: cgImage)
        guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
        return "data:image/png;base64," + png.base64EncodedString()
    }
}
