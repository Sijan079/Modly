pub mod modrinth;

use anyhow::Result;

use crate::models::scout::{CandidateMod, CandidateSearchRequest};

#[allow(async_fn_in_trait)]
pub trait ModProvider {
    async fn search(&self, request: &CandidateSearchRequest) -> Result<Vec<CandidateMod>>;
}
