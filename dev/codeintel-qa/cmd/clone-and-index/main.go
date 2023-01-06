package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/sourcegraph/conc/pool"
	"github.com/sourcegraph/run"

	"github.com/sourcegraph/sourcegraph/dev/codeintel-qa/internal"
	"github.com/sourcegraph/sourcegraph/dev/sg/root"
)

func main() {
	if err := mainErr(context.Background()); err != nil {
		fmt.Printf("%s error: %s\n", internal.EmojiFailure, err.Error())
		os.Exit(1)
	}
}

const (
	relativeReposDir   = "dev/codeintel-qa/testdata/repos"
	relativeIndexesDir = "dev/codeintel-qa/testdata/indexes"
)

var repositoryMeta = []struct {
	name      string
	language  string
	revisions []string
}{
	// This repository has not been changed
	{
		name:     "zap",
		language: "go",
		revisions: []string{
			"a6015e13fab9b744d96085308ce4e8f11bad1996",
			"2aa9fa25da83bdfff756c36a91442edc9a84576c",
		},
	},

	//  Each commit here is tagged as sg-test-1, sg-test-2, and sg-test-3, respectively. See CHANGES.md in the root of the
	//  repository's master branch to see a history of changes and which revisions were targeted. We specifically use replace
	//  directives in the project root's go.mod file to target sourcegraph-testing/zap, which has no changes of its own. This
	//  simulates how common forking works in the Go ecosystem (see our own use of zoekt).
	//
	//  To ensure that the last commit in the list for each repository is visible at tip, the master branch's last commit is
	//  a merge commit between the true upstream tip and sg-test-3.
	{
		name:     "etcd",
		language: "go",
		revisions: []string{
			"4397ceb9c11be0b3e9ee0111230235c868ba581d",
			"bc588b7a2e9af4f903396cdcf66f56190b9e254f",
			"ad7848014a051dbe3fcd6a4cff2c7befdd16d5a8",
		},
	},
	{
		name:     "tidb",
		language: "go",
		revisions: []string{
			"8eaaa098b4e938b18485f7b1fa7d8e720b04c699",
			"b5f100a179e20d5539e629bd0919d05774cb7c6a",
			"9aab49176993f9dc0ed2fcb9ef7e5125518e8b98",
		},
	},
	{
		name:     "titan",
		language: "go",
		revisions: []string{
			"fb38de395ba67f49978b218e099de1c45122fb50",
			"415ffd5a3ba7a92a07cd96c7d9f4b734f61248f7",
			"f8307e394c512b4263fc0cd67ccf9fd46f1ad9a5",
		},
	},
}

func mainErr(ctx context.Context) error {
	if err := cloneAll(ctx); err != nil {
		return err
	}

	if err := indexAll(ctx); err != nil {
		return err
	}

	return nil
}

func cloneAll(ctx context.Context) error {
	p := pool.New().WithErrors()

	for _, meta := range repositoryMeta {
		name := meta.name
		p.Go(func() error { return clone(ctx, name) })
	}

	return p.Wait()
}

func clone(ctx context.Context, name string) error {
	repoRoot, err := root.RepositoryRoot()
	if err != nil {
		return err
	}
	reposDir := filepath.Join(repoRoot, relativeReposDir)

	if err := os.MkdirAll(reposDir, os.ModePerm); err != nil {
		return err
	}

	if _, err := os.Stat(filepath.Join(reposDir, name)); err != nil {
		if !os.IsNotExist(err) {
			return err
		}
	} else {
		fmt.Printf("Repository %q already cloned\n", name)
		return nil
	}

	fmt.Printf("Cloning %q\n", name)
	if err := run.Bash(ctx, "git", "clone", fmt.Sprintf("https://github.com/sourcegraph-testing/%s.git", name)).Dir(reposDir).Run().Wait(); err != nil {
		return err
	}

	fmt.Printf("Finished cloning %q\n", name)
	return nil
}

func indexAll(ctx context.Context) error {
	repoRoot, err := root.RepositoryRoot()
	if err != nil {
		return err
	}
	reposDir := filepath.Join(repoRoot, relativeReposDir)
	indexesDir := filepath.Join(repoRoot, relativeIndexesDir)

	if err := os.MkdirAll(indexesDir, os.ModePerm); err != nil {
		return err
	}

	p := pool.New().WithErrors()

	for _, meta := range repositoryMeta {
		name := meta.name

		index, ok := indexFunMap[meta.language]
		if !ok {
			panic(fmt.Sprintf("unknown language %q", meta.language))
		}

		p.Go(func() error {
			for _, revision := range meta.revisions {
				if err := index(ctx, reposDir, indexesDir, name, revision); err != nil {
					return err
				}
			}

			return nil
		})
	}

	return p.Wait()
}

var indexFunMap = map[string]func(context.Context, string, string, string, string) error{
	"go":         indexGo,
	"typescript": indexTypeScript,
}

func indexGo(ctx context.Context, reposDir, indexesDir, name, revision string) error {
	targetFile := filepath.Join(indexesDir, name+"."+revision+".dump")

	if _, err := os.Stat(targetFile); err != nil {
		if !os.IsNotExist(err) {
			return err
		}
	} else {
		fmt.Printf("Index for %s%s already exists\n", name, revision)
		return nil
	}

	fmt.Printf("Indexing %s@%s\n", name, revision)

	tempDir, err := os.MkdirTemp("", "codeintel-qa")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tempDir)

	repoDir := filepath.Join(reposDir, name)
	repoCopyDir := filepath.Join(tempDir, name)

	if err := run.Bash(ctx, "cp", "-r", repoDir, tempDir).Run().Wait(); err != nil {
		return err
	}
	if err := run.Bash(ctx, "git", "checkout", revision).Dir(repoCopyDir).Run().Wait(); err != nil {
		return err
	}
	if err := run.Bash(ctx, "go", "mod", "vendor").Dir(repoCopyDir).Run().Wait(); err != nil {
		return err
	}
	// --repository-root=. is necessary here as the temp dir might be within a strange
	// nest of symlinks on MacOS, which confuses the repository root detection in lsif-go.
	if err := run.Bash(ctx, "lsif-go", "--repository-root=.", "-o", targetFile).Dir(repoCopyDir).Run().Wait(); err != nil {
		return err
	}

	fmt.Printf("Finished indexing %s@%s\n", name, revision)
	return nil
}

func indexTypeScript(ctx context.Context, reposDir, indexesDir, name, revision string) error {
	return errors.New("typescript indexing currently unsupported")
}
