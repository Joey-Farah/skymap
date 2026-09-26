import Capacitor

/// Capacitor's bridge, plus the plugins that live in this app target rather
/// than in npm packages. Those aren't discovered automatically, so they are
/// registered here.
class SkyMapBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TipJarPlugin())
    }
}
