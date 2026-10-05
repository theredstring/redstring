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
// answer outside it. Each request gets a fresh session — the Druid's calls are
// independent and carry their own context.
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
func permissiveText(_ req: Request, property: String, options: GenerationOptions) async -> String? {
    let model = SystemLanguageModel(guardrails: .permissiveContentTransformations)
    let session = LanguageModelSession(model: model, instructions: req.system)
    guard let response = try? await session.respond(to: req.user ?? "", options: options) else { return nil }
    let text = response.content.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let data = try? JSONSerialization.data(withJSONObject: [property: text], options: [.sortedKeys]) else { return nil }
    return String(data: data, encoding: .utf8)
}

func complete(_ req: Request) async -> [String: Any] {
    let model = SystemLanguageModel.default
    guard case .available = model.availability else {
        return ["id": req.id, "ok": false, "error": "model unavailable"].merging(availabilityReport()) { a, _ in a }
    }
    let user = req.user ?? ""
    let session = LanguageModelSession(model: model, instructions: req.system)
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
        if #available(macOS 26.4, *) {
            if let p = try? await model.tokenCount(for: (req.system ?? "") + "\n" + user) { usage["prompt"] = p }
            if let c = try? await model.tokenCount(for: content) { usage["completion"] = c }
        }
        return ["id": req.id, "ok": true, "content": content, "usage": usage]
    } catch let error as LanguageModelSession.GenerationError {
        switch error {
        case .exceededContextWindowSize:
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
        write(await complete(req))
    default:
        write(["id": req.id, "ok": false, "error": "unknown op \(req.op)"])
    }
}
