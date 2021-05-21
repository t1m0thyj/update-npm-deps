# Update NPM Deps action

GitHub Action to update NPM dependencies in protected branches

## Inputs

### `commit`

Commit changes to package.json and package-lock.json. Default `false`.

<!-- ## Outputs

### `time`

The time we greeted you. -->

## Example usage

```yaml
uses: t1m0thyj/update-npm-deps@master
with:
  commit: true
```
