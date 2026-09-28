use super::*;

impl Database {
    pub fn get_crash_analysis(
        &self,
        instance_id: &str,
        fingerprint: &str,
    ) -> Result<Option<CrashAnalysis>> {
        let conn = self
            .conn
            .lock()
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        let mut statement = conn.prepare(
            "SELECT analysis_json FROM crash_analyses WHERE instance_id = ?1 AND fingerprint = ?2",
        )?;
        let mut rows = statement.query_map(params![instance_id, fingerprint], |row| {
            row.get::<_, String>(0)
        })?;
        rows.next()
            .transpose()?
            .map(|json| serde_json::from_str(&json).map_err(Into::into))
            .transpose()
    }

    pub fn get_latest_crash_analysis(&self, instance_id: &str) -> Result<Option<CrashAnalysis>> {
        let conn = self
            .conn
            .lock()
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        let mut statement = conn.prepare(
            "SELECT analysis_json FROM crash_analyses WHERE instance_id = ?1 ORDER BY analyzed_at DESC LIMIT 1",
        )?;
        let mut rows = statement.query_map(params![instance_id], |row| row.get::<_, String>(0))?;
        rows.next()
            .transpose()?
            .map(|json| serde_json::from_str(&json).map_err(Into::into))
            .transpose()
    }

    pub fn save_crash_analysis(&self, analysis: &CrashAnalysis) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        conn.execute(
            "INSERT OR REPLACE INTO crash_analyses (instance_id, fingerprint, analyzed_at, analysis_json) VALUES (?1, ?2, ?3, ?4)",
            params![analysis.instance_id, analysis.fingerprint, analysis.analyzed_at, serde_json::to_string(analysis)?],
        )?;
        Ok(())
    }

    pub fn get_issue_source(
        &self,
        instance_id: &str,
        file_path: &str,
    ) -> Result<Option<IssueSource>> {
        let conn = self
            .conn
            .lock()
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        let mut statement = conn.prepare(
            "SELECT project_id, issue_url, source_url, repository, provider, checked_at, status FROM issue_sources WHERE instance_id = ?1 AND file_path = ?2",
        )?;
        let mut rows = statement.query_map(params![instance_id, file_path], |row| {
            Ok(IssueSource {
                instance_id: instance_id.to_string(),
                file_path: file_path.to_string(),
                project_id: row.get(0)?,
                issue_url: row.get(1)?,
                source_url: row.get(2)?,
                repository: row.get(3)?,
                provider: row.get(4)?,
                checked_at: row.get(5)?,
                status: row.get(6)?,
            })
        })?;
        rows.next().transpose().map_err(Into::into)
    }

    pub fn save_issue_source(&self, source: &IssueSource) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        conn.execute(
            "INSERT INTO issue_sources (instance_id, file_path, project_id, issue_url, source_url, repository, provider, checked_at, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(instance_id, file_path) DO UPDATE SET project_id=excluded.project_id, issue_url=excluded.issue_url,
             source_url=excluded.source_url, repository=excluded.repository, provider=excluded.provider,
             checked_at=excluded.checked_at, status=excluded.status",
            params![source.instance_id, source.file_path, source.project_id, source.issue_url,
                source.source_url, source.repository, source.provider, source.checked_at, source.status],
        )?;
        Ok(())
    }

    pub fn get_community_issue_cache(
        &self,
        cache_key: &str,
    ) -> Result<Option<(String, Vec<CommunityIssue>)>> {
        let conn = self
            .conn
            .lock()
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        let mut statement = conn.prepare(
            "SELECT fetched_at, issues_json FROM community_issue_cache WHERE cache_key = ?1",
        )?;
        let mut rows = statement.query_map(params![cache_key], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.next()
            .transpose()?
            .map(|(at, json)| Ok((at, serde_json::from_str(&json)?)))
            .transpose()
    }

    pub fn save_community_issue_cache(
        &self,
        cache_key: &str,
        issues: &[CommunityIssue],
    ) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        conn.execute(
            "INSERT INTO community_issue_cache (cache_key, fetched_at, issues_json) VALUES (?1, ?2, ?3)
             ON CONFLICT(cache_key) DO UPDATE SET fetched_at=excluded.fetched_at, issues_json=excluded.issues_json",
            params![cache_key, chrono::Utc::now().to_rfc3339(), serde_json::to_string(issues)?],
        )?;
        Ok(())
    }
}
