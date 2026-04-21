## Summary

- what changed
- why it changed

## Validation

- [ ] `npm run check`
- [ ] `npm run test`
- [ ] `npm run build`

## Public release checks

- [ ] no secrets were added
- [ ] no runtime logs or screenshots were added
- [ ] no private local paths were added to committed files
- [ ] the supported deployment path is still `gatewayIndex.ts + agentIndex.ts`

## Notes for reviewers

- review the supported public deployment path first
- treat local bridge and userscript code as legacy unless the change explicitly targets removal or migration
