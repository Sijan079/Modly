use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use anyhow::{Context, Result};

use crate::models::launch::{LaunchConfig, LaunchStatus};

pub struct LauncherService {
    child: Mutex<Option<Child>>,
    active_instance: Mutex<Option<String>>,
}

impl LauncherService {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            active_instance: Mutex::new(None),
        }
    }

    pub fn status(&self) -> LaunchStatus {
        let mut child_guard = self.child.lock().unwrap();
        let instance_id = self.active_instance.lock().unwrap().clone();

        if let Some(child) = child_guard.as_mut() {
            match child.try_wait() {
                Ok(Some(_)) => {
                    *child_guard = None;
                    LaunchStatus {
                        running: false,
                        pid: None,
                        instance_id: None,
                    }
                }
                Ok(None) => LaunchStatus {
                    running: true,
                    pid: Some(child.id()),
                    instance_id,
                },
                Err(_) => LaunchStatus {
                    running: false,
                    pid: None,
                    instance_id: None,
                },
            }
        } else {
            LaunchStatus {
                running: false,
                pid: None,
                instance_id: None,
            }
        }
    }

    pub fn launch(&self, java_path: &str, game_dir: &str, config: &LaunchConfig) -> Result<u32> {
        if self.status().running {
            anyhow::bail!("A Minecraft instance is already running");
        }

        let java = if java_path.is_empty() {
            detect_java().context("No Java executable configured or found")?
        } else {
            java_path.to_string()
        };

        let mut args: Vec<String> = vec![
            format!("-Xms{}M", config.min_memory_mb),
            format!("-Xmx{}M", config.max_memory_mb),
        ];

        if !config.jvm_args.is_empty() {
            args.extend(config.jvm_args.split_whitespace().map(|s| s.to_string()));
        }

        args.push("-Dminecraft.client.jar".to_string());
        args.push(format!("-Djava.library.path={game_dir}/natives"));
        args.push("-cp".to_string());
        args.push(".".to_string());
        args.push("net.minecraft.client.main.Main".to_string());

        if !config.game_args.is_empty() {
            args.extend(config.game_args.split_whitespace().map(|s| s.to_string()));
        } else {
            args.push("--gameDir".to_string());
            args.push(game_dir.to_string());
        }

        let child = Command::new(&java)
            .args(&args)
            .current_dir(game_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .with_context(|| format!("Failed to launch Java at {java}"))?;

        let pid = child.id();
        *self.child.lock().unwrap() = Some(child);
        *self.active_instance.lock().unwrap() = Some(config.instance_id.clone());

        Ok(pid)
    }

    pub fn stop(&self) -> Result<()> {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            child.kill()?;
            let _ = child.wait();
        }
        *self.active_instance.lock().unwrap() = None;
        Ok(())
    }
}

pub fn detect_java() -> Result<String> {
    let candidates = if cfg!(windows) {
        vec!["java", "javaw"]
    } else {
        vec!["java"]
    };

    for candidate in candidates {
        if Command::new(candidate)
            .arg("-version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Ok(candidate.to_string());
        }
    }

    if cfg!(windows) {
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            let search_roots = [
                Path::new(&program_files).join("Java"),
                Path::new(&program_files).join("Eclipse Adoptium"),
                Path::new(&program_files).join("Microsoft"),
            ];
            for root in search_roots {
                if let Some(found) = find_java_in_dir(&root) {
                    return Ok(found);
                }
            }
        }
    }

    anyhow::bail!("Java not found in PATH")
}

fn find_java_in_dir(dir: &Path) -> Option<String> {
    if !dir.exists() {
        return None;
    }
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_java_in_dir(&path) {
                return Some(found);
            }
        }
    }
    let exe = if cfg!(windows) {
        dir.join("bin").join("javaw.exe")
    } else {
        dir.join("bin").join("java")
    };
    if exe.exists() {
        return Some(exe.to_string_lossy().to_string());
    }
    None
}
