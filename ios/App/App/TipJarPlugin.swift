import Capacitor
import StoreKit

/// The tip jar's bridge to StoreKit. Tips are consumables: nothing to unlock,
/// nothing to restore, so all this does is list them and buy one.
///
/// Kept in the app target rather than pulled in as a package: three
/// consumables don't justify a purchase library, and there is no server to
/// validate receipts against. StoreKit 2 verifies the transaction on-device.
@objc(TipJarPlugin)
public class TipJarPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TipJarPlugin"
    public let jsName = "TipJar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
    ]

    private var products: [String: Product] = [:]

    /// Ask to Buy approvals and purchases interrupted mid-flow arrive here,
    /// not as the result of a purchase call. Unfinished, StoreKit redelivers
    /// them on every launch. Started once however many bridges load.
    private static var listener: Task<Void, Never>?

    override public func load() {
        if TipJarPlugin.listener == nil {
            TipJarPlugin.listener = Task.detached {
                for await update in Transaction.updates {
                    if case .verified(let transaction) = update {
                        await transaction.finish()
                    }
                }
            }
        }
    }

    /// Resolves `{ products: [{ id, displayPrice }] }`, cheapest first. An
    /// empty list — not an error — when the store can't be reached or the
    /// products aren't set up; the web layer then hides the tip jar.
    @objc func getProducts(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        Task { @MainActor in
            let found = (try? await Product.products(for: ids)) ?? []
            self.products = Dictionary(uniqueKeysWithValues: found.map { ($0.id, $0) })
            call.resolve([
                "products": found.sorted { $0.price < $1.price }.map { ["id": $0.id, "displayPrice": $0.displayPrice] },
            ])
        }
    }

    /// Resolves `{ result }`: purchased, cancelled, pending (Ask to Buy), or
    /// failed. Never rejects — every outcome is one the card shows.
    @objc func purchase(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let product = products[id] else {
            call.resolve(["result": "failed"])
            return
        }
        Task { @MainActor in
            do {
                let outcome: Product.PurchaseResult
                // Scene-based apps should say which scene the payment sheet
                // belongs to; purchase() without one is the iOS 15/16 path.
                if #available(iOS 17.0, *), let scene = self.bridge?.viewController?.view.window?.windowScene {
                    outcome = try await product.purchase(confirmIn: scene)
                } else {
                    outcome = try await product.purchase()
                }
                switch outcome {
                case .success(.verified(let transaction)):
                    await transaction.finish()
                    call.resolve(["result": "purchased"])
                case .success(.unverified):
                    call.resolve(["result": "failed"])
                case .userCancelled:
                    call.resolve(["result": "cancelled"])
                case .pending:
                    call.resolve(["result": "pending"])
                @unknown default:
                    call.resolve(["result": "failed"])
                }
            } catch {
                call.resolve(["result": "failed"])
            }
        }
    }
}
