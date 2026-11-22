//! Compose only the explicitly reviewed pages from the two frozen conflict sources.
use super::*;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Source {
    Local,
    Remote,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Choice {
    Local,
    Remote,
    Both,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Selection {
    page_id: String,
    choice: Choice,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Plan {
    general: Source,
    choices: Vec<Selection>,
}

pub(super) fn compose(local: &Value, remote: &Value, plan: &Value) -> Result<Value> {
    handwritten::serialize_note(local)?;
    handwritten::serialize_note(remote)?;
    let plan: Plan = serde_json::from_value(plan.clone()).map_err(|_| Error::input())?;
    let pages = |note: &Value| -> Result<Vec<Value>> {
        note["pages"]
            .as_array()
            .filter(|items| items.len() <= 1000)
            .cloned()
            .ok_or_else(Error::input)
    };
    let local_pages = pages(local)?;
    let remote_pages = pages(remote)?;
    fn by_id(pages: &[Value]) -> Result<BTreeMap<String, Value>> {
        let mut result = BTreeMap::new();
        for page in pages {
            let id = page["id"].as_str().ok_or_else(Error::input)?;
            if result.insert(id.into(), page.clone()).is_some() {
                return Err(Error::input());
            }
        }
        Ok(result)
    }
    let a = by_id(&local_pages)?;
    let b = by_id(&remote_pages)?;
    let (primary, secondary) = match plan.general {
        Source::Local => (local, remote),
        Source::Remote => (remote, local),
    };
    let mut ids = Vec::new();
    let mut reserved = BTreeSet::new();
    for note in [primary, secondary] {
        for page in note["pages"].as_array().ok_or_else(Error::input)? {
            let id = page["id"].as_str().ok_or_else(Error::input)?;
            if reserved.insert(id.to_owned()) {
                ids.push(id.to_owned());
            }
        }
    }
    for note in [local, remote] {
        if let Some(texts) = note["ocr"]["textByPage"].as_object() {
            reserved.extend(texts.keys().cloned());
        }
    }
    if plan.choices.len() > 2000 {
        return Err(Error::input());
    }
    let mut choices = BTreeMap::new();
    for item in plan.choices {
        if choices.insert(item.page_id, item.choice).is_some() {
            return Err(Error::input());
        }
    }
    let mut result = primary.clone();
    result["id"] = local["id"].clone();
    let texts = result["ocr"]["textByPage"]
        .as_object_mut()
        .ok_or_else(Error::input)?;
    for id in &ids {
        texts.remove(id);
    }
    let mut merged = Vec::new();
    let mut next_id = 1usize;
    for id in ids {
        let changed = a.get(&id) != b.get(&id)
            || local["ocr"]["textByPage"].get(&id) != remote["ocr"]["textByPage"].get(&id);
        let choice = if changed {
            choices.remove(&id).ok_or_else(Error::input)?
        } else {
            if choices.contains_key(&id) {
                return Err(Error::input());
            }
            match plan.general {
                Source::Local => Choice::Local,
                Source::Remote => Choice::Remote,
            }
        };
        let sources: Vec<(Option<&Value>, &Value, bool)> = match choice {
            Choice::Local => vec![(a.get(&id), local, false)],
            Choice::Remote => vec![(b.get(&id), remote, false)],
            Choice::Both => vec![
                (a.get(&id), local, false),
                (b.get(&id), remote, a.contains_key(&id)),
            ],
        };
        for (page, source, copy) in sources {
            let Some(page) = page else {
                continue;
            };
            let mut page = page.clone();
            let destination = if copy {
                loop {
                    let candidate = format!("merge-page-{next_id}");
                    next_id += 1;
                    if reserved.insert(candidate.clone()) {
                        break candidate;
                    }
                }
            } else {
                id.clone()
            };
            page["id"] = json!(destination);
            merged.push(page);
            if let Some(text) = source["ocr"]["textByPage"].get(&id) {
                result["ocr"]["textByPage"][&destination] = text.clone();
            }
        }
    }
    if !choices.is_empty() || merged.is_empty() || merged.len() > 1000 {
        return Err(Error::input());
    }
    result["pages"] = json!(merged);
    handwritten::serialize_note(&result)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn proton_note_merge_preserves_page_text_and_assigns_collision_free_copy_ids() {
        let mut local = handwritten::new_note("Source.nbnote");
        local["ocr"]["textByPage"]["page-1"] = json!("Local text");
        local["ocr"]["textByPage"]["merge-page-1"] = json!("Reserved orphan text");
        let mut remote = local.clone();
        remote["pages"][0]["title"] = json!("Remote title");
        remote["ocr"]["textByPage"]["page-1"] = json!("Remote text");
        let plan = json!({"general":"remote","choices":[{"pageId":"page-1","choice":"both"}]});
        let merged = compose(&local, &remote, &plan).unwrap();
        assert_eq!(merged["pages"][0], local["pages"][0]);
        assert_eq!(merged["pages"][1]["id"], "merge-page-2");
        assert_eq!(merged["ocr"]["textByPage"]["merge-page-2"], "Remote text");
        assert_eq!(merged["ocr"]["textByPage"]["page-1"], "Local text");
        assert!(compose(&local, &remote, &json!({"general":"local","choices":[]})).is_err());
        assert!(compose(
            &local,
            &remote,
            &json!({"general":"local","choices":[{"pageId":"unknown","choice":"both"}]})
        )
        .is_err());
        assert_eq!(remote["pages"][0]["title"], "Remote title");
    }
}
