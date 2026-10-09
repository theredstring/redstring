# Ontology import fixtures

## zoo.*

One small ontology written five ways: Turtle (`zoo.ttl`, the source), N-Triples
(`zoo.nt`) and JSON-LD (`zoo.jsonld`) generated from it, and RDF/XML
(`zoo.owl`) and OBO Graphs JSON (`zoo.obographs.json`) written by hand. The
tests require all five to give the same index. It covers: multiple parents, an
individual (`rdf:type`), existential restrictions (`has part`, `has role`, a
custom relation between parts), a part declaring `part of` its whole, an
`equivalentClass` intersection, synonyms of two scopes, a cross-reference, a
non-English label, a deprecated term with a replacement, and `owl:Thing` as a
parent. Written for these tests; no licence restrictions.

## chebi-lite-water-ethanol.owl

A real slice of **ChEBI LITE, release 256 (6 October 2026)**: water
(CHEBI:15377) and ethanol (CHEBI:16236) one level down, their ancestors and
parts, and the targets of their relations. 75 class blocks and the property
declarations, copied verbatim from `chebi_lite.owl`.

ChEBI is © EMBL-EBI and is licensed under
[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).
Source: <https://ftp.ebi.ac.uk/pub/databases/chebi/ontology/>. Hastings J, et
al. *ChEBI in 2016: Improved services and an expanding collection of metabolites.*
Nucleic Acids Res. 2016.

## wikidata-water.ttl

A trimmed copy of Wikidata's export of water (Q283), in the shape
`Special:EntityData/Q283.ttl` writes it: the dataset node, two sitelinks, direct
claims (between items, to a string, to an image, an external ID and its
normalized IRI, Wikimedia housekeeping), a statement node with a qualifier and
a reference, a value node, labelled items that appear only in a qualifier or a
reference, and property entities with their direct-claim and novalue
declarations. Values are Wikidata's, which is
[CC0](https://creativecommons.org/publicdomain/zero/1.0/).
