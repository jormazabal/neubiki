use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};

/// Compare the parsed structure and protected content, allowing prose to change.
pub fn translation_preserves_markdown(source: &str, output: &str) -> bool {
    let source_parser = translation_parser(source);
    let output_parser = translation_parser(output);
    reference_definitions(source, &source_parser) == reference_definitions(output, &output_parser)
        && protected_events(source_parser).eq(protected_events(output_parser))
}

fn translation_parser(markdown: &str) -> Parser<'_> {
    Parser::new_ext(
        markdown,
        Options::ENABLE_TABLES
            | Options::ENABLE_TASKLISTS
            | Options::ENABLE_STRIKETHROUGH
            | Options::ENABLE_FOOTNOTES
            | Options::ENABLE_YAML_STYLE_METADATA_BLOCKS
            | Options::ENABLE_PLUSES_DELIMITED_METADATA_BLOCKS,
    )
}

fn reference_definitions<'a>(markdown: &'a str, parser: &Parser<'_>) -> Vec<&'a str> {
    let mut definitions: Vec<_> = parser
        .reference_definitions()
        .iter()
        .map(|(_, definition)| definition.span.clone())
        .collect();
    definitions.sort_by_key(|span| span.start);
    definitions
        .into_iter()
        .map(|span| &markdown[span])
        .collect()
}

fn protected_events<'a>(parser: Parser<'a>) -> impl Iterator<Item = Event<'a>> {
    let mut literal_block = false;
    parser.filter(move |event| match event {
        Event::Start(Tag::CodeBlock(_) | Tag::MetadataBlock(_)) => {
            literal_block = true;
            true
        }
        Event::End(TagEnd::CodeBlock | TagEnd::MetadataBlock(_)) => {
            literal_block = false;
            true
        }
        Event::Text(_) | Event::SoftBreak => literal_block,
        _ => true,
    })
}

#[cfg(test)]
mod tests {
    use super::translation_preserves_markdown;

    const SOURCE: &str = r#"---
project: original
---

# Welcome

- [x] Find **the guide** and run `neubiki --open`.
- [More][help]

| Name | Status |
| ---- | :----: |
| Test | Active |

![A diagram](assets/example.png "Example")

<!-- neubiki-image: {"version":1,"ratio":0.5} -->

```mermaid
graph TD
    A --> B
```

[help]: https://example.test/docs
"#;

    #[test]
    fn allows_translated_prose_and_preserves_markdown_structure() {
        let translated = SOURCE
            .replace("Welcome", "Bienvenida")
            .replace("Find **the guide** and run", "Busca **la guía** y ejecuta")
            .replace("[More]", "[Más]")
            .replace("Name | Status", "Nombre | Estado")
            .replace("Test | Active", "Prueba | Activa")
            .replace("A diagram", "Un diagrama");
        assert!(translation_preserves_markdown(SOURCE, &translated));
    }

    #[test]
    fn rejects_changes_to_structure_code_links_and_protected_metadata() {
        for (original, changed) in [
            ("# Welcome", "## Welcome"),
            ("**the guide**", "the guide"),
            ("- [x]", "- [ ]"),
            (":----:", "------"),
            ("neubiki --open", "neubiki --close"),
            ("A --> B", "B --> C"),
            ("assets/example.png", "assets/other.png"),
            ("example.test/docs", "example.test/other"),
            ("project: original", "project: changed"),
            ("\"ratio\":0.5", "\"ratio\":0.9"),
        ] {
            assert!(
                !translation_preserves_markdown(SOURCE, &SOURCE.replace(original, changed)),
                "accepted a change to {original}"
            );
        }
        assert!(!translation_preserves_markdown(
            "Read [the guide](https://example.test/guide).",
            "Lee [la guía](https://example.test/other)."
        ));
        assert!(!translation_preserves_markdown(
            "Read <https://example.test/guide>.",
            "Lee <https://example.test/other>."
        ));
    }
}
