//
//  ViewController.swift
//  PageSearchForSafari
//

import UIKit
import WebKit

class ViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    private let messageHandlerName = "controller"

    override func viewDidLoad() {
        super.viewDidLoad()

        webView.navigationDelegate = self
        webView.configuration.userContentController.add(self, name: messageHandlerName)
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.backgroundColor = .systemBackground

        // Bundle.main resolves Main.html to the .lproj matching the user's language.
        guard let url = Bundle.main.url(forResource: "Main", withExtension: "html"),
              let resources = Bundle.main.resourceURL else { return }
        webView.loadFileURL(url, allowingReadAccessTo: resources)
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: messageHandlerName)
    }

    // MARK: - WKNavigationDelegate

    // The guide itself is a local file; the privacy policy and terms links belong in Safari.
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        if url.isFileURL {
            decisionHandler(.allow)
            return
        }

        decisionHandler(.cancel)
        UIApplication.shared.open(url)
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.body as? String == "open-settings",
              let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }
}
