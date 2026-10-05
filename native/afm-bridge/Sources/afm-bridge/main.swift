// afm-bridge — Apple's on-device language model, for the Druid.
//
// A line-oriented JSON protocol over stdin/stdout. No network listener, so
// nothing on the machine but the process that spawned it can reach the model.
//
//   → {"id":1,"op":"health"}
//   ← {"id":1,"ok":true,"available":true,"contextSize":4096}
//
//   → {"id":2,"op":"complete","system":"…","user":"…","maxTokens":16,"temperature":0.6,
//      "schema":{"name":"choice","schema":{"type":"object","properties":{"choice":{"type":"string","enum":["1","2"]}},"required":["choice"]}}}
//   ← {"id":2,"ok":true,"content":"{\"choice\":\"2\"}","usage":{"prompt":812,"completion":3}}
//
// The answer shape is locked by guided generation: the JSON-schema subset the
// Druid uses (an object of string properties, each optionally a string enum)
// is translated to a DynamicGenerationSchema, so the model cannot produce an
// answer outside it.
//
// Sessions. Reading the prompt is nearly all of a call's time (about 1 ms a
// token). A request with a "sid" and a "context" starts a session whose
// instructions are the system prompt and that context; a later request with
// the same "sid" and no context is a turn in it, so the context is not read
// again. The Druid's calls in one moment share their context this way.
//   → {"id":3,"op":"complete","sid":"m1","system":"…","context":"…","user":"What do you do next?…",…}
//   → {"id":4,"op":"complete","sid":"m1","user":"Name the new web.",…}
//   → {"id":5,"op":"end","sid":"m1"}
// A request without "sid" gets a fresh session, as before. "usage": true asks
// for token counts (they cost a little on every call).
//
// Apple's guardrails block some plain questions on plain subjects ("What makes
// up Death?"). A blocked answer that is one free string (the Druid's fill) is
// asked once more under the permissive guardrails, which pass text responses
// but not guided ones, and the text is put back in the shape asked for. The
// reply then carries "permissive": true.

import Foundation
import FoundationModels

struct Request: Decodable {
    let id: Int
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

/// Each session's context, for the permissive retry, which starts afresh.
var contexts: [String: String] = [:]

/// Sessions kept for follow-up turns, newest last; a few at most.
var sessions: [(sid: String, session: LanguageModelSession)] = []
let SESSIONS_KEPT = 3

@MainActor
func sessionFor(_ req: Request, model: SystemLanguageModel) -> LanguageModelSession? {
    if let sid = req.sid {
        if let context = req.context {
            sessions.removeAll { $0.sid == sid }
            let instructions = [req.system ?? "", context].filter { !$0.isEmpty }.joined(separator: "\n\n")
            let session = LanguageModelSession(model: model, instructions: instructions)
            sessions.append((sid, session))
            if sessions.count > SESSIONS_KEPT { sessions.removeFirst(sessions.count - SESSIONS_KEPT) }
            return session
        }
        return sessions.first { $0.sid == sid }?.session
    }
    return LanguageModelSession(model: model, instructions: req.system)
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

func write(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
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
@MainActor
func permissiveText(_ req: Request, property: String, options: GenerationOptions) async -> String? {
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

@MainActor
func complete(_ req: Request) async -> [String: Any] {
    let model = SystemLanguageModel.default
    guard case .available = model.availability else {
        return ["id": req.id, "ok": false, "error": "model unavailable"].merging(availabilityReport()) { a, _ in a }
    }
    let user = req.user ?? ""
    guard let session = sessionFor(req, model: model) else {
        return ["id": req.id, "ok": false, "error": "unknown session"]
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
        if req.usage == true, #available(macOS 26.4, *) {
            if let p = try? await model.tokenCount(for: (req.system ?? "") + "\n" + user) { usage["prompt"] = p }
            if let c = try? await model.tokenCount(for: content) { usage["completion"] = c }
        }
        return ["id": req.id, "ok": true, "content": content, "usage": usage]
    } catch let error as LanguageModelSession.GenerationError {
        switch error {
        case .exceededContextWindowSize:
            if let sid = req.sid { sessions.removeAll { $0.sid == sid } }
            return ["id": req.id, "ok": false, "error": "exceededContextWindowSize"]
        case .guardrailViolation:
            if let property = singleTextProperty(req.schema), let content = await permissiveText(req, property: property, options: options) {
                return ["id": req.id, "ok": true, "content": content, "usage": [String: Any](), "permissive": true]
            }
            return ["id": req.id, "ok": false, "error": "guardrailViolation"]
        default:
            return ["id": req.id, "ok": false, "error": String(describing: error)]
        }
    } catch {
        return ["id": req.id, "ok": false, "error": String(describing: error)]
    }
}

// Requests are handled one at a time, in order: the model runs one generation
// at a time anyway, and in-order answers keep the protocol trivial.
let decoder = JSONDecoder()
while let line = readLine(strippingNewline: true) {
    if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
    guard let data = line.data(using: .utf8), let req = try? decoder.decode(Request.self, from: data) else {
        write(["id": -1, "ok": false, "error": "bad request"])
        continue
    }
    switch req.op {
    case "health":
        write(["id": req.id, "ok": true].merging(availabilityReport()) { a, _ in a })
    case "prewarm":
        LanguageModelSession(instructions: req.system).prewarm()
        write(["id": req.id, "ok": true])
    case "complete":
        if let sid = req.sid, let context = req.context { contexts[sid] = context }
        write(await complete(req))
    case "end":
        if let sid = req.sid { sessions.removeAll { $0.sid == sid }; contexts[sid] = nil }
        write(["id": req.id, "ok": true])
    default:
        write(["id": req.id, "ok": false, "error": "unknown op \(req.op)"])
    }
}
