//
//  SafariWebExtensionHandler.swift
//  PageSearchForSafari Extension
//

import SafariServices

// Page Search runs entirely in the web extension; the native handler only exists
// because Safari requires an extension principal class.
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: ["ok": true]]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
