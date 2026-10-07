// AppleModelCore — Apple's on-device language model behind one small request
// protocol, shared by the Mac helper (Sources/afm-bridge, over stdio, for the
// desktop app) and the iOS plugin (ios/Sources, through Capacitor, for iPhone
// and iPad). One JSON object in, one out:
//
//   {"op":"health"}
//     → {"ok":true,"available":true,"contextSize":4096}
//
//   {"op":"complete","system":"…","user":"…","maxTokens":16,"temperature":0.6,
//    "schema":{"name":"choice","schema":{"type":"object","properties":{"choice":{"type":"string","enum":["1","2"]}},"required":["choice"]}}}
//     → {"ok":true,"content":"{\"choice\":\"2\"}","usage":{"prompt":812,"completion":3}}
//
// The answer shape is locked by guided generation: the JSON-schema subset the
// Druid uses (an object of string properties, each optionally a string enum)
// is translated to a DynamicGenerationSchema, so the model cannot produce an
// answer outside it. Without a schema the answer is plain text (the Wizard's
// chat).
//
// Sessions. Reading the prompt is nearly all of a call's time (about 1 ms a
// token). A request with a "sid" and a "context" starts a session whose
// instructions are the system prompt and that context; a later request with
// the same "sid" and no context is a turn in it, so the context is not read
// again. The Druid's calls in one moment share their context this way.
//   {"op":"complete","sid":"m1","system":"…","context":"…","user":"What do you do next?…",…}
//   {"op":"complete","sid":"m1","user":"Name the new web.",…}
//   {"op":"end","sid":"m1"}
// A request without "sid" gets a fresh session. "usage": true asks for token
// counts (they cost a little on every call).
//
// Apple's guardrails block some plain questions on plain subjects ("What makes
// up Death?"). A blocked answer that is one free string (the Druid's fill) is
// asked once more under the permissive guardrails, which pass text responses
// but not guided ones, and the text is put back in the shape asked for. The
// reply then carries "permissive": true.
//
// The model needs macOS 26 or iOS 26 and an Apple Intelligence device. On
// anything older, health says so and nothing else is attempted.

import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

struct AppleModelRequest: Decodable {
    let id: Int?
    let op: String
    let system: String?
    let user: String?
    let maxTokens: Int?
    let temperature: Double?
    let schema: SchemaSpec?
    let sid: String?
    let context: String?
    let usage: Bool?
}

struct SchemaSpec: Decodable {
    let name: String
    let schema: ObjectSchema
}

struct ObjectSchema: Decodable {
    let properties: [String: PropertySchema]
    let required: [String]?
}

struct PropertySchema: Decodable {
    let type: String?
    let `enum`: [String]?
    let description: String?
}

/// The protocol's entry point. Requests are handled one at a time, in order:
/// the model runs one generation at a time anyway.
@MainActor
public final class AppleModelCore {
    private let decoder = JSONDecoder()
    private var state: AnyObject?

    public init() {}

    /// One request (a JSON object, as data) → its reply, with the request's
    /// "id" carried back when it had one.
    public func handle(_ data: Data) async -> [String: Any] {
        guard let req = try? decoder.decode(AppleModelRequest.self, from: data) else {
            return ["id": -1, "ok": false, "error": "bad request"]
        }
        var reply = await respond(req)
        if let id = req.id { reply["id"] = id }
        return reply
    }

    private func respond(_ req: AppleModelRequest) async -> [String: Any] {
        #if canImport(FoundationModels)
        if #available(macOS 26.0, iOS 26.0, *) {
            let live = (state as? LiveModel) ?? LiveModel()
            state = live
            return await live.respond(req)
        }
        #endif
        if req.op == "health" { return ["ok": true, "available": false, "reason": "osTooOld"] }
        return ["ok": false, "available": false, "error": "model unavailable", "reason": "osTooOld"]
    }
}

#if canImport(FoundationModels)
@available(macOS 26.0, iOS 26.0, *)
@MainActor
final class LiveModel {
    /// Each session's context, for the permissive retry, which starts afresh.
    var contexts: [String: String] = [:]
    /// Sessions kept for follow-up turns, newest last; a few at most.
    var sessions: [(sid: String, session: LanguageModelSession)] = []
    let sessionsKept = 3

    func respond(_ req: AppleModelRequest) async -> [String: Any] {
        switch req.op {
        case "health":
            return ["ok": true].merging(availabilityReport()) { a, _ in a }
        case "prewarm":
            LanguageModelSession(instructions: req.system).prewarm()
            return ["ok": true]
        case "complete":
            if let sid = req.sid, let context = req.context { contexts[sid] = context }
            return await complete(req)
        case "end":
            if let sid = req.sid { sessions.removeAll { $0.sid == sid }; contexts[sid] = nil }
            return ["ok": true]
        default:
            return ["ok": false, "error": "unknown op \(req.op)"]
        }
    }

    func sessionFor(_ req: AppleModelRequest, model: SystemLanguageModel) -> LanguageModelSession? {
        if let sid = req.sid {
            if let context = req.context {
                sessions.removeAll { $0.sid == sid }
                let instructions = [req.system ?? "", context].filter { !$0.isEmpty }.joined(separator: "\n\n")
                let session = LanguageModelSession(model: model, instructions: instructions)
                sessions.append((sid, session))
                if sessions.count > sessionsKept { sessions.removeFirst(sessions.count - sessionsKept) }
                return session
            }
            return sessions.first { $0.sid == sid }?.session
        }
        return LanguageModelSession(model: model, instructions: req.system)
    }

    func availabilityReport() -> [String: Any] {
        let model = SystemLanguageModel.default
        var out: [String: Any] = ["contextSize": model.contextSize]
        switch model.availability {
        case .available:
            out["available"] = true
        case .unavailable(let reason):
            out["available"] = false
            switch reason {
            case .deviceNotEligible: out["reason"] = "deviceNotEligible"
            case .appleIntelligenceNotEnabled: out["reason"] = "appleIntelligenceNotEnabled"
            case .modelNotReady: out["reason"] = "modelNotReady"
            @unknown default: out["reason"] = "unknown"
            }
        }
        return out
    }

    /// The Druid's schema subset → a dynamic generation schema.
    func generationSchema(_ spec: SchemaSpec) throws -> GenerationSchema {
        // Stable order: required first, in their given order, then the rest.
        let required = spec.schema.required ?? []
        let names = required + spec.schema.properties.keys.filter { !required.contains($0) }.sorted()
        let properties: [DynamicGenerationSchema.Property] = names.compactMap { name in
            guard let p = spec.schema.properties[name] else { return nil }
            let schema: DynamicGenerationSchema
            if let choices = p.enum, !choices.isEmpty {
                schema = DynamicGenerationSchema(name: "\(spec.name)_\(name)", anyOf: choices)
            } else {
                schema = DynamicGenerationSchema(type: String.self)
            }
            return DynamicGenerationSchema.Property(name: name, description: p.description, schema: schema, isOptional: !required.contains(name))
        }
        let root = DynamicGenerationSchema(name: spec.name, properties: properties)
        return try GenerationSchema(root: root, dependencies: [])
    }

    /// The one free-string property of a schema, if that is all it asks for (a fill).
    func singleTextProperty(_ spec: SchemaSpec?) -> String? {
        guard let spec, spec.schema.properties.count == 1, let (name, p) = spec.schema.properties.first,
              (p.enum ?? []).isEmpty, (p.type ?? "string") == "string" else { return nil }
        return name
    }

    /// The same request as plain text, under the permissive guardrails, put back in its one property.
    func permissiveText(_ req: AppleModelRequest, property: String, options: GenerationOptions) async -> String? {
        let model = SystemLanguageModel(guardrails: .permissiveContentTransformations)
        let session = LanguageModelSession(model: model, instructions: req.system)
        // A turn in a session carries only its question: the context goes with it here.
        let context = req.context ?? (req.sid.flatMap { sid in contexts[sid] } ?? "")
        let user = [context, req.user ?? ""].filter { !$0.isEmpty }.joined(separator: "\n\n")
        guard let response = try? await session.respond(to: user, options: options) else { return nil }
        let text = response.content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let data = try? JSONSerialization.data(withJSONObject: [property: text], options: [.sortedKeys]) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func complete(_ req: AppleModelRequest) async -> [String: Any] {
        let model = SystemLanguageModel.default
        guard case .available = model.availability else {
            return ["ok": false, "error": "model unavailable"].merging(availabilityReport()) { a, _ in a }
        }
        let user = req.user ?? ""
        guard let session = sessionFor(req, model: model) else {
            return ["ok": false, "error": "unknown session"]
        }
        let options = GenerationOptions(temperature: req.temperature, maximumResponseTokens: req.maxTokens)
        do {
            var content: String
            if let spec = req.schema {
                let schema = try generationSchema(spec)
                let response = try await session.respond(to: user, schema: schema, options: options)
                content = response.content.jsonString
            } else {
                let response = try await session.respond(to: user, options: options)
                content = response.content
            }
            var usage: [String: Any] = [:]
            if req.usage == true, #available(macOS 26.4, iOS 26.4, *) {
                if let p = try? await model.tokenCount(for: (req.system ?? "") + "\n" + user) { usage["prompt"] = p }
                if let c = try? await model.tokenCount(for: content) { usage["completion"] = c }
            }
            return ["ok": true, "content": content, "usage": usage]
        } catch let error as LanguageModelSession.GenerationError {
            switch error {
            case .exceededContextWindowSize:
                if let sid = req.sid { sessions.removeAll { $0.sid == sid } }
                return ["ok": false, "error": "exceededContextWindowSize"]
            case .guardrailViolation:
                if let property = singleTextProperty(req.schema), let content = await permissiveText(req, property: property, options: options) {
                    return ["ok": true, "content": content, "usage": [String: Any](), "permissive": true]
                }
                return ["ok": false, "error": "guardrailViolation"]
            default:
                return ["ok": false, "error": String(describing: error)]
            }
        } catch {
            return ["ok": false, "error": String(describing: error)]
        }
    }
}
#endif
