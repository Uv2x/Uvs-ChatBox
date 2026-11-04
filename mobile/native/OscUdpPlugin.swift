//  OscUdpPlugin.swift
//
//  Minimal send-only UDP plugin for the OSC chatbox. After `npx cap add ios`,
//  add this file to the App target in Xcode (drag it into the App/App group,
//  "Copy items if needed", target = App). Capacitor 6 auto-discovers the
//  CAPBridgedPlugin — no manual registration needed.
//
//  JS side: registerPlugin<OscUdpPlugin>('OscUdp') in src/osc.ts.

import Foundation
import Capacitor
import Network

@objc(OscUdpPlugin)
public class OscUdpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OscUdpPlugin"
    public let jsName = "OscUdp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "com.uvschatbox.osc.udp")

    @objc func send(_ call: CAPPluginCall) {
        guard let host = call.getString("host"),
              let portInt = call.getInt("port"),
              let b64 = call.getString("dataBase64"),
              let data = Data(base64Encoded: b64),
              let port = NWEndpoint.Port(rawValue: UInt16(truncatingIfNeeded: portInt))
        else {
            call.reject("bad args (host/port/dataBase64)")
            return
        }

        let conn = NWConnection(host: NWEndpoint.Host(host), port: port, using: .udp)
        conn.stateUpdateHandler = { state in
            switch state {
            case .ready:
                conn.send(content: data, completion: .contentProcessed { err in
                    conn.cancel()
                    if let err = err {
                        call.reject("send failed: \(err)")
                    } else {
                        call.resolve()
                    }
                })
            case .failed(let err):
                conn.cancel()
                call.reject("connection failed: \(err)")
            case .cancelled:
                break
            default:
                break
            }
        }
        conn.start(queue: queue)
    }
}
