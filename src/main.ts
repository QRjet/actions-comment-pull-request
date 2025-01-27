const fs = require('fs');
const path = require('path');
import * as github from '@actions/github';
import * as core from '@actions/core';
import { GetResponseDataTypeFromEndpointMethod } from '@octokit/types';

// See https://docs.github.com/en/rest/reactions#reaction-types
const REACTIONS = ['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes'] as const;
type Reaction = typeof REACTIONS[number];

async function run() {
  try {
    let message: string = core.getInput('message');
    const filePath: string = core.getInput('filePath');
    const github_token: string = core.getInput('GITHUB_TOKEN');
    const pr_number: string = core.getInput('pr_number');
    const comment_includes: string = core.getInput('comment_includes');
    const reactions: string = core.getInput('reactions');

    if (!filePath && !message) {
      throw new Error('either filePath or message input should be provided!');
    }

    if (filePath) {
      if (!process.env.GITHUB_WORKSPACE) {
        throw new Error('GITHUB_WORKSPACE is not set! please make sure to use action/checkout action!');
      }

      const fileFullPath = path.join(process.env.GITHUB_WORKSPACE, filePath);

      message = fs.readFileSync(fileFullPath, 'utf8');
    }

    const context = github.context;
    const pull_number = parseInt(pr_number) || context.payload.pull_request?.number;

    const octokit = github.getOctokit(github_token);

    if (!pull_number) {
      core.setFailed('No pull request in input neither in current context.');
      return;
    }

    async function addReactions(comment_id: number, reactions: string) {
      const validReactions = <Reaction[]>reactions
        .replace(/\s/g, '')
        .split(',')
        .filter((reaction) => REACTIONS.includes(<Reaction>reaction));

      await Promise.allSettled(
        validReactions.map(async (content) => {
          await octokit.rest.reactions.createForIssueComment({
            ...context.repo,
            comment_id,
            content,
          });
        }),
      );
    }

    if (comment_includes) {
      type ListCommentsResponseDataType = GetResponseDataTypeFromEndpointMethod<
        typeof octokit.rest.issues.listComments
      >;
      let comment: ListCommentsResponseDataType[0] | undefined;
      for await (const { data: comments } of octokit.paginate.iterator(octokit.rest.issues.listComments, {
        ...context.repo,
        issue_number: pull_number,
      })) {
        comment = comments.find((comment) => comment?.body?.includes(comment_includes));
        if (comment) break;
      }

      if (comment) {
        await octokit.rest.issues.updateComment({
          ...context.repo,
          comment_id: comment.id,
          body: message,
        });
        await addReactions(comment.id, reactions);
        return;
      } else {
        core.info('No comment has been found with asked pattern. Creating a new comment.');
      }
    }

    const { data: comment } = await octokit.rest.issues.createComment({
      ...context.repo,
      issue_number: pull_number,
      body: message,
    });

    await addReactions(comment.id, reactions);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

run();
