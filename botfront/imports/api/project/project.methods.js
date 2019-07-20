import { check, Match } from 'meteor/check';
import { Projects } from './project.collection';
import { NLUModels } from '../nlu_model/nlu_model.collection';
import { createInstance } from '../instances/instances.methods';
import { Instances } from '../instances/instances.collection';
import { ActivityCollection } from '../activity';
import { formatError } from '../../lib/utils';
import { CorePolicies, createPolicies } from '../core_policies';
import { createEndpoints } from '../endpoints/endpoints.methods';
import { Endpoints } from '../endpoints/endpoints.collection';
import { Credentials, createCredentials } from '../credentials';
import { createDeployment } from '../deployment/deployment.methods';
import { Deployments } from '../deployment/deployment.collection';
import { checkIfCan } from '../../lib/scopes';
import { createIntroStoryGroup } from '../storyGroups/storyGroups.methods';
import { StoryGroups } from '../storyGroups/storyGroups.collection';
import { Stories } from '../story/stories.collection';

if (Meteor.isServer) {
    Meteor.methods({
        async 'project.insert'(item) {
            check(item, Object);
            checkIfCan('global-admin');
            let _id;
            try {
                _id = Projects.insert(item);
                createEndpoints({ _id, ...item });
                createDeployment({ _id, ...item });
                createCredentials({ _id, ...item });
                createPolicies({ _id, ...item });
                createIntroStoryGroup(_id);
                const instance = await createInstance({ _id, ...item });
                Projects.update({ _id }, { $set: { instance } });
                return _id;
            } catch (e) {
                if (_id) Meteor.call('project.delete', _id);
                throw formatError(e);
            }
        },

        'project.update'(item) {
            check(item, Match.ObjectIncluding({ _id: String }));
            checkIfCan('project-settings:w', item._id);
            try {
                // eslint-disable-next-line no-param-reassign
                delete item.createdAt;
                return Projects.update({ _id: item._id }, { $set: item });
            } catch (e) {
                throw formatError(e);
            }
        },

        'project.delete'(projectId) {
            check(projectId, String);
            checkIfCan('global-admin');

            const project = Projects.findOne({ _id: projectId }, { fields: { nlu_models: 1 } });
            if (!project) throw new Meteor.Error('Project not found');
            try {
                NLUModels.remove({ _id: { $in: project.nlu_models } }); // Delete NLU models
                ActivityCollection.remove({ modelId: { $in: project.nlu_models } }); // Delete Logs
                Instances.remove({ projectId: project._id }); // Delete instances
                CorePolicies.remove({ projectId: project._id }); // Delete Core Policies
                Credentials.remove({ projectId: project._id }); // Delete credentials
                Endpoints.remove({ projectId: project._id }); // Delete endpoints
                StoryGroups.remove({ projectId });
                Stories.remove({ projectId });
                Projects.remove({ _id: projectId }); // Delete project
                Deployments.remove({ projectId }); // Delete deployment
                // Delete project related permissions for users (note: the role package does not provide
                const projectUsers = Meteor.users.find({ [`roles.${project._id}`]: { $exists: true } }, { fields: { roles: 1 } }).fetch();
                projectUsers.forEach(u => Meteor.users.update({ _id: u._id }, { $unset: { [`roles.${project._id}`]: '' } })); // Roles.removeUsersFromRoles doesn't seem to work so we unset manually
            } catch (e) {
                throw e;
            }
        },

        'project.markTrainingStarted'(projectId) {
            check(projectId, String);
            checkIfCan('nlu-model:x', projectId);
    
            try {
                return Projects.update({ _id: projectId }, { $set: { training: { status: 'training', startTime: new Date() } } });
            } catch (e) {
                throw e;
            }
        },

        'project.markTrainingStopped'(projectId, status, error) {
            check(projectId, String);
            check(status, String);
            check(error, Match.Optional(String));
            checkIfCan('nlu-model:x', projectId);
    
            try {
                const set = { training: { status, endTime: new Date() } };
                if (error) {
                    set.training.message = error;
                }
                return Projects.update({ _id: projectId }, { $set: set });
            } catch (e) {
                throw e;
            }
        },
    });
}
